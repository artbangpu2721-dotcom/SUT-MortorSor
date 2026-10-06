const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');

// Route สำหรับทดสอบระบบ
router.get('/test', (req, res) => {
    res.json({ message: "Backend พร้อมทำงานแล้ว! 🚀" });
});

// Route สำหรับดึงข้อมูลรายวิชา (ส่งไปหา Controller)
router.get('/courses', courseController.getAllCourses);

// Route สำหรับดึงข้อมูลตารางเรียน
router.get('/timetable', courseController.getTimetable);

// Route สำหรับแนะนำรายวิชาแบบ auto 
router.get('/recommend', courseController.getStudyPlan);

// Route สำหรับดึงข้อมูลสาขาวิชาไปแสดงที่หน้า Register
router.get('/programs', courseController.getAllPrograms);

// Route สำหรับ chatbot
router.get('/course/:courseCode', courseController.getCourseForAI);

module.exports = router;