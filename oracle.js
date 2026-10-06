const oracledb = require('oracledb');
require('dotenv').config();

// บังคับให้ใช้ Thin Mode จะได้ไม่ต้องลงโปรแกมเยอะ จุ๊บบๆ 
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

async function initialize() {
    try {
        // สร้างท่อเชื่อมต่อไปยังฐานข้อมูลอาจารย์
        await oracledb.createPool({
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            connectString: process.env.DB_CONNECTION_STRING,
            poolMin: 2,
            poolMax: 10,
            poolIncrement: 1
        });
        console.log('✅ เชื่อมต่อ Oracle Database สำเร็จพร้อมใช้งาน!');
    } catch (err) {
        console.error('❌ การเชื่อมต่อ Oracle ล้มเหลว:', err.message);
    }
}

// ฟังก์ชันสำหรับปิดการเชื่อมต่อ
async function close() {
    await oracledb.getPool().close(0);
}

module.exports = { initialize, close, oracledb };