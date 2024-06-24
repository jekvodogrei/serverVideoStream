const { spawn } = require('child_process');

function processVideo(url, folderPath) {
    const ffmpeg = spawn('ffmpeg', [
        '-i', url,
        '-c:v', 'h264_nvenc', // Кодек H.264 з апаратним прискоренням
        '-movflags', 'frag_keyframe+empty_moov',
        '-hls_time', '2', // Тривалість кожного сегменту 2 секунди
        '-hls_list_size', '20', // Максимальна кількість сегментів у плейлисті
        '-hls_flags', 'delete_segments', // Видаляти старі сегменти
        '-hls_segment_filename', `${folderPath}/stream_%03d.ts`, // Формат ім'я файлів сегментів
        `${folderPath}/stream.m3u8`, // Ім'я плейлисту
    ]);

    // Обробка виводу ffmpeg
    ffmpeg.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    // Обробка помилок ffmpeg
    ffmpeg.on('error', (err) => {
        console.error('ffmpeg помилка:', err);
    });

    // Обробка закінчення роботи ffmpeg
    ffmpeg.on('close', (code) => {
        console.log(`ffmpeg завершив роботу з кодом ${code}`);
    });
}

module.exports = { processVideo };