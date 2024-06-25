const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const { spawn } = require("child_process");
const bodyParser = require("body-parser");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const WebSocket = require("ws");
const moment = require("moment-timezone");

const app = express();
const PORT = 3001;
const JWT_SECRET = "evgen";

const videoServerSchema = new mongoose.Schema({
   ip: String,
   port: Number,
   lastChecked: Date,
});

const cameraSchema = new mongoose.Schema({
   name: String,
   url: String,
   ip: String,
   videoServerIp: String,
   videoServerPort: Number,
});

const userSchema = new mongoose.Schema({
   phone: String,
   lastChecked: Date,
   isActive: Boolean,
});

app.use(bodyParser.json());

const corsOptions = {
   origin: "*",
   methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
   allowedHeaders: "Content-Type, Authorization",
};

app.use(cors(corsOptions));

const VideoServer = mongoose.model("VideoServer", videoServerSchema);
const Camera = mongoose.model("Camera", cameraSchema);
const User = mongoose.model("User", userSchema);

mongoose.connect("mongodb://91.196.177.159:27017/triolan", {});

function delay(ms) {
   return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkAndUpdateDate() {
   const newDateString = new Date().toISOString().split("T")[0];
   if (newDateString !== currentDateString) {
      currentDateString = newDateString;
      console.log(`Switched to new date: ${currentDateString}`);
   }
}

const db = mongoose.connection;
db.on(
   "error",
   console.error.bind(console, "Помилка підключення до бази даних:")
);
db.once("open", async function () {
   console.log("Успішне підключення до бази даних");
   setInterval(checkAndUpdateDate, 5 * 1000);
   setInterval(checkUserSubscriptions, 24 * 60 * 60 * 1000);
});

const dbConfig = [
   {
      url: "mongodb://91.196.177.159:27017/triolan",
      videoServer: "http://91.196.177.159:3007",
   },
];

app.use(express.json());

app.use(express.static("public"));

async function connectToDatabases() {
   for (const config of dbConfig) {
      await mongoose.createConnection(config.url, {
         useNewUrlParser: true,
         useUnifiedTopology: true,
      });
   }
}

async function testConnection(videoServerIp, videoServerPort) {
   try {
      const response = await axios.get(
         `http://${videoServerIp}:${videoServerPort}/info`
      );
      console.log(
         `Successfully connected to video server at ${videoServerIp}:${videoServerPort}`
      );
   } catch (error) {
      console.error(
         `Failed to connect to video server at ${videoServerIp}:${videoServerPort}: ${error.message}`
      );
   }
}

testConnection("localhost", 3007);

async function updateVideoServers() {
   for (const config of dbConfig) {
      try {
         const response = await axios.get(`${config.videoServer}/info`);
         const { ip, port } = response.data;

         await VideoServer.findOneAndUpdate(
            { ip, port },
            { ip, port, lastChecked: new Date() },
            { upsert: true }
         );
      } catch (error) {
         console.error(`Error updating video server info: ${error.message}`);
      }
   }
}

async function updateCameras() {
   for (const config of dbConfig) {
      try {
         const response = await axios.get(`${config.videoServer}/cameras`);
         const cameras = response.data;

         for (const camera of cameras) {
            await Camera.findOneAndUpdate(
               { ip: camera.ip },
               {
                  ...camera,
                  videoServerIp: config.videoServer,
                  videoServerPort: config.port,
               },
               { upsert: true }
            );
         }
      } catch (error) {
         console.error(`Error updating cameras: ${error.message}`);
      }
   }
}

connectToDatabases().then(async () => {
   console.log("Connected to all databases");
   await updateVideoServers();
   await updateCameras();
   setInterval(updateVideoServers, 10 * 60 * 1000); // Оновлювати кожні 10 хвилин
   setInterval(updateCameras, 10 * 60 * 1000); // Оновлювати кожні 10 хвилин
});

app.post("/login", async (req, res) => {
   const { phone } = req.body;
   try {
      const response = await axios.get(
         `https://tvstat.triolan.com.ua/sheduler.php?how=view_youtv_status_by_phone&phone=${phone}`
      );
      const userData = response.data;
      const state = userData.Subscribes[0].State;
      if (state === 0) {
         const token = jwt.sign({ phone }, JWT_SECRET, { expiresIn: "1h" });
         console.log("Generated token:", token);
         await User.findOneAndUpdate(
            { phone },
            { lastChecked: new Date(), isActive: true },
            { upsert: true }
         );
         res.status(200).json({
            message: "User authenticated successfully",
            token,
         });
      } else if (state === -1) {
         res.status(401).json({ message: "User not registered" });
      } else if (state === 1) {
         res.status(403).json({ message: "Insufficient funds" });
      } else {
         res.status(500).json({ message: "Unknown error occurred" });
      }
   } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
   }
});

function authenticateUserToken(req, res, next) {
   const authHeader = req.headers["authorization"];
   const token = authHeader && authHeader.split(" ")[1];
   if (!token) return res.sendStatus(401);

   jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
   });
}

async function checkUserSubscriptions() {
   const users = await User.find({});
   for (const user of users) {
      try {
         const response = await axios.get(
            `https://tvstat.triolan.com.ua/sheduler.php?how=view_youtv_status_by_phone&phone=${user.phone}`
         );
         const userData = response.data;
         const state = userData.Subscribes[0].State;

         if (state === 0) {
            const token = jwt.sign({ phone: user.phone }, JWT_SECRET, {
               expiresIn: "1h",
            });
            await User.findOneAndUpdate(
               { phone: user.phone },
               { isActive: true, lastChecked: new Date(), token }
            );

            if (clients[user.phone]) {
               clients[user.phone].send(
                  JSON.stringify({ type: "updateToken", token })
               );
            }
         } else {
            await User.findOneAndUpdate(
               { phone: user.phone },
               { isActive: false, lastChecked: new Date() }
            );
         }
      } catch (error) {
         console.error(
            `Error checking subscription for user ${user.phone}:`,
            error
         );
      }
   }
}

app.get("/stream/:cameraIp", async (req, res) => {
   const cameraIp = req.params.cameraIp;
   const camera = await Camera.findOne({ ip: cameraIp });

   if (!camera) {
      console.error(`Camera with IP ${cameraIp} not found`);
      return res.status(404).send("Camera not found");
   }

   try {
      const response = await axios.get(
         `http://${camera.videoServerIp}:${camera.videoServerPort}/stream/${cameraIp}`
      );
      res.redirect(response.data.url);
   } catch (error) {
      console.error(
         `Error fetching stream URL for camera IP ${cameraIp}: ${error.message}`
      );
      res.status(500).send("Error fetching stream URL");
   }
});

app.get("/video/:cameraIp/:segment", async (req, res) => {
   const { cameraIp, segment } = req.params;
   const currentDate = moment().tz("Europe/Kiev").format("YYYY-MM-DD");
   console.log(
      `Received request for segment: ${segment} from camera IP: ${cameraIp} on date: ${currentDate}`
   );
   const camera = await Camera.findOne({ ip: cameraIp });

   if (!camera) {
      console.error(`Camera with IP ${cameraIp} not found`);
      return res.status(404).send("Camera not found");
   }

   const videoServerUrl = `http://${camera.videoServerIp}:${camera.videoServerPort}/video/${currentDate}/${cameraIp}/${segment}`;
   console.log(`Requesting video segment from video server: ${videoServerUrl}`);

   try {
      const response = await axios.get(videoServerUrl, {
         responseType: "stream",
      });
      console.log(`Fetched segment from video server: ${camera.videoServerIp}`);
      response.data.pipe(res);
   } catch (error) {
      console.error(
         `Error fetching video segment for camera IP ${cameraIp}: ${error.message}`
      );
      res.status(500).send("Error fetching video segment");
   }
});

app.get("/archive/:cameraIp/:startDate/:endDate", async (req, res) => {
   const { cameraIp, startDate, endDate } = req.params;
   const camera = await Camera.findOne({ ip: cameraIp });

   if (!camera) {
      return res.status(404).send("Camera not found");
   }

   try {
      const response = await axios.get(
         `http://${camera.videoServerIp}:${camera.videoServerPort}/archive/${cameraIp}/${startDate}/${endDate}`
      );
      res.redirect(response.data.url);
   } catch (error) {
      res.status(500).send("Error fetching archive URL");
   }
});

app.get("/some-protected-route", authenticateUserToken, (req, res) => {
   res.send("Protected route accessed");
});

app.get("/", authenticateUserToken, async (req, res) => {
   try {
      const cameras = await Camera.find({}).exec();
      res.json(cameras);
   } catch (error) {
      console.error("Error:", error.message);
      res.status(500).send("Internal Server Error");
   }
});

app.get("/cameras", authenticateUserToken, async (req, res) => {
   try {
      const cameras = await Camera.find({}).exec();
      res.json(cameras);
   } catch (error) {
      console.error("Error:", error.message);
      res.status(500).send("Internal Server Error");
   }
});

let currentDateString = new Date().toISOString().split("T")[0];

app.use("/videos", express.static(path.join(__dirname, "public/videos")));

app.get(
   "/video/:cameraIp/stream.m3u8",
   authenticateUserToken,
   async (req, res) => {
      const cameraIp = req.params.cameraIp;
      const camera = await Camera.findOne({ ip: cameraIp });

      if (!camera) {
         return res.status(404).send("Camera not found");
      }

      try {
         const response = await axios.get(
            `http://${camera.videoServerIp}:${camera.videoServerPort}/stream/${cameraIp}`,
            { responseType: "stream" }
         );
         response.data.pipe(res);
      } catch (error) {
         console.error("Error fetching playlist:", error.message);
         res.status(500).send("Error fetching playlist");
      }
   }
);

app.get(
   "/videos/:date/:cameraIp/:segment",
   authenticateUserToken,
   async (req, res) => {
      const { date, cameraIp, segment } = req.params;
      const camera = await Camera.findOne({ ip: cameraIp });

      if (!camera) {
         return res.status(404).send("Camera not found");
      }

      try {
         const response = await axios.get(
            `http://${camera.videoServerIp}:${camera.videoServerPort}/videos/${date}/${cameraIp}/${segment}`,
            { responseType: "stream" }
         );
         response.data.pipe(res);
      } catch (error) {
         console.error("Error fetching segment:", error.message);
         res.status(500).send("Error fetching segment");
      }
   }
);

app.get("/merge-video", authenticateUserToken, async (req, res) => {
   try {
      const { startDate, endDate } = req.query;
      const { cameraIp } = req.query;
      const startDateTime = new Date(startDate);
      const endDateTime = new Date(endDate);
      const foundFiles = await searchFiles(
         cameraIp,
         startDateTime,
         endDateTime
      );
      if (foundFiles.length === 0) {
         console.log("No files found with the specified date range.");
         return res
            .status(404)
            .send("No files found within the specified date range.");
      }
      const mergedVideo = await mergeVideoFiles(cameraIp, foundFiles);
      addTempFile(mergedVideo);
      console.log("Merge video:", mergedVideo);
      res.json({ url: mergedVideo });
   } catch (error) {
      console.error("Error:", error);
      res.status(500).send("An error occurred.");
   }
});

const videosDir = path.join(__dirname, "public", "videos");
const mergedDir = path.join(__dirname, "public", "merged");

if (!fs.existsSync(mergedDir)) {
   fs.mkdirSync(mergedDir, { recursive: true });
}

async function searchFiles(cameraIp, startDate, endDate) {
   const foundFiles = [];
   for (
      let date = new Date(startDate);
      date <= endDate;
      date.setDate(date.getDate() + 1)
   ) {
      const dateString = date.toISOString().split("T")[0];
      const directoryPath = path.join(videosDir, dateString, cameraIp);
      if (fs.existsSync(directoryPath)) {
         const files = await fs.readdir(directoryPath);
         files.forEach((file) => {
            const filePath = path.join(directoryPath, file);
            const stats = fs.statSync(filePath);
            const fileCreationDate = stats.birthtime;
            if (fileCreationDate >= startDate && fileCreationDate <= endDate) {
               foundFiles.push(filePath);
            }
         });
      }
   }
   return foundFiles;
}

function mergeVideoFiles(cameraIp, files) {
   return new Promise((resolve, reject) => {
      const outputFilePath = path.join(mergedDir, `${cameraIp}_output.mp4`);
      const fileList = files.map((file) => `file '${file}'`).join("\n");
      fs.writeFileSync("fileList.txt", fileList);
      const ffmpegCommand = spawn("ffmpeg", [
         "-y",
         "-f",
         "concat",
         "-safe",
         "0",
         "-i",
         "fileList.txt",
         "-c",
         "copy",
         outputFilePath,
      ]);
      ffmpegCommand.stderr.on("data", (data) => {
         console.error(`ffmpeg stderr: ${data}`);
      });
      ffmpegCommand.on("close", (code) => {
         if (code === 0) {
            resolve(outputFilePath);
         } else {
            reject(`ffmpeg process exited with code ${code}`);
         }
      });
   });
}

const monthNames = [
   "січня",
   "лютого",
   "березня",
   "квітня",
   "травня",
   "червня",
   "липня",
   "серпня",
   "вересня",
   "жовтня",
   "листопада",
   "грудня",
];

function formatMonth(month) {
   return monthNames[month];
}

function formatFileDate(date) {
   const day = date.getDate();
   const month = date.getMonth();
   const year = date.getFullYear();
   const hours = date.getHours().toString().padStart(2, "0");
   const minutes = date.getMinutes().toString().padStart(2, "0");
   const seconds = date.getSeconds().toString().padStart(2, "0");
   return `${day} ${formatMonth(
      month
   )} ${year} р., ${hours}:${minutes}:${seconds}`;
}

app.get(
   "/archives/:cameraIp/:startDate/:endDate",
   authenticateUserToken,
   async (req, res) => {
      const { cameraIp, startDate, endDate } = req.params;
      try {
         const start = new Date(startDate);
         const end = new Date(endDate);
         const foundFiles = await searchFiles(cameraIp, start, end);
         if (foundFiles.length === 0) {
            console.log("No files found.");
            return res.status(404).send("No files found.");
         }
         console.log("Found files:", foundFiles);
         const mergedVideo = await mergeVideoFiles(cameraIp, foundFiles);
         if (mergedVideo) {
            console.log("Merged video:", mergedVideo);
            const randomFileName = `${uuidv4()}.mp4`;
            fs.renameSync(mergedVideo, path.join(mergedDir, randomFileName));
            res.json({
               url: `http://91.196.177.159:19922/merged/${randomFileName}`,
            });
         } else {
            console.log("No files to merge.");
            res.status(404).send("No files to merge");
         }
      } catch (error) {
         console.error("Error:", error);
         res.status(500).send("An error occurred.");
      }
   }
);

app.use((req, res, next) => {
   console.log(`Received request: ${req.method} ${req.url}`);
   next();
});

app.use(bodyParser.json());

app.use("/merged", express.static(mergedDir));

app.get(
   "/archives/download/:cameraIp/:file",
   authenticateUserToken,
   (req, res) => {
      const { cameraIp, file } = req.params;
      const filePath = path.join(__dirname, "public", "videos", cameraIp, file);
      res.download(filePath);
   }
);

app.get("/archives/dates", authenticateUserToken, async (req, res) => {
   try {
      const { cameraIp } = req.query;
      if (!cameraIp) {
         return res.status(400).send("Camera IP is required");
      }
      const archiveDir = path.join(videosDir, cameraIp);
      if (!fs.existsSync(archiveDir)) {
         return res.json([]);
      }
      const files = await fs.readdir(archiveDir);
      const dates = files.filter((file) =>
         fs.lstatSync(path.join(archiveDir, file)).isDirectory()
      );
      res.json(dates);
   } catch (error) {
      console.error("Error:", error.message);
      res.status(500).send("Internal Server Error");
   }
});

app.get(
   "/archives/:cameraIp/:date",
   authenticateUserToken,
   async (req, res) => {
      const { cameraIp, date } = req.params;
      try {
         const videoDir = path.join(
            __dirname,
            "public",
            "videos",
            cameraIp,
            date
         );
         if (!fs.existsSync(videoDir)) {
            return res
               .status(404)
               .send("No videos found for the specified date");
         }
         const videoFiles = await fs.readdir(videoDir);
         res.json(videoFiles);
      } catch (error) {
         console.error("Error:", error.message);
         res.status(500).send("Internal Server Error");
      }
   }
);

app.get("/api/video", authenticateUserToken, async (req, res) => {
   const date = new Date(parseInt(req.query.date, 10));
   const ip = req.query.ip;
   await checkAndUpdateDate();
   const playlistPath = path.join(
      __dirname,
      "public",
      "videos",
      ip,
      currentDateString,
      "stream.m3u8"
   );
   if (fs.existsSync(playlistPath)) {
      res.json({
         url: `/videos/${ip}/${currentDateString}/stream.m3u8`,
      });
   } else {
      res.status(404).json({
         error: "Video not found for the selected date and time",
      });
   }
});

// WebSocket сервер
const wss = new WebSocket.Server({ noServer: true });
const clients = {};

wss.on("connection", (ws, req) => {
   const phone = req.url.split("/").pop();
   clients[phone] = ws;
   ws.on("close", () => {
      delete clients[phone];
   });
});

// HTTP сервер для WebSocket
const server = app.listen(PORT, () => {
   console.log(`Archive server is running on http://localhost:${PORT}`);
});

server.on("upgrade", (request, socket, head) => {
   wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
   });
});
