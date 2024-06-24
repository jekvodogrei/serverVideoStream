const mongoose = require('mongoose');

// Підключення до бази даних MongoDB
mongoose.connect('mongodb://localhost:27017/triolan', { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'Помилка підключення до бази даних:'));
db.once('open', async function() {
    console.log('Успішне підключення до бази даних');

    // Створення схеми для камер
    const cameraSchema = new mongoose.Schema({
        name: String,
        url: String,
        ip: String
    });

    // Створення моделі камери
    const Camera = mongoose.model('Camera', cameraSchema);

    // Створення схеми для користувачів
    const userSchema = new mongoose.Schema({
        name: String,
        phone: String,
        password: String,
        cameras: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Camera' }] // Список камер, які доступні для користувача
    });

    // Створення моделі користувача
    const User = mongoose.model('User', userSchema);

    try {
        // Отримання всіх камер з бази даних
        const cameras = await Camera.find({}).exec();

        // Додавання декількох користувачів до бази даних
        const usersToAdd = [
         { name: 'Суперадмін', phone: '0932701698', password: '12345', cameras: cameras.map(camera => camera._id) }, // Для суперадміна всі камери доступні
         { name: 'Користувач 1', phone: '0930000000', password: '1234', cameras: [cameras[0]._id] }, // Користувач 1 має доступ лише до першої камери
         { name: 'Користувач 2', phone: '0930000001', password: '1234', cameras: [cameras[1]._id] }, // Користувач 2 має доступ лише до другої камери
         { name: 'Користувач 3', phone: '0930000002', password: '1234', cameras: [cameras[2]._id] }, // Користувач 3 має доступ лише до третьої камери
      ];

        // Додавання кожного користувача до бази даних
        await User.insertMany(usersToAdd);

        console.log('Користувачі успішно додані до бази даних.');
        // Закриття з'єднання з базою даних після додавання користувачів
        db.close();
    } catch (error) {
        console.error('Помилка при додаванні користувачів:', error);
    }
});