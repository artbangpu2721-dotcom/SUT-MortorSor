const database = require('../config/oracle');

// 📦 ฟังก์ชันที่ 1: ดึงรายวิชา (ปลดลิมิตแล้ว)
exports.getAllCourses = async (req, res) => {
    let connection;
    try {
        connection = await database.oracledb.getConnection();
        const result = await connection.execute(
            `SELECT COURSECODE, COURSENAME, COURSEUNIT 
             FROM EXP_COURSE`,
            [], 
            { 
                outFormat: database.oracledb.OUT_FORMAT_OBJECT,
                maxRows: 50000 
            }
        );
        res.status(200).json({ status: "success", total: result.rows.length, data: result.rows });
    } catch (err) {
        console.error("❌ เกิดข้อผิดพลาดในการดึงข้อมูลวิชา:", err);
        res.status(500).json({ error: "ไม่สามารถดึงข้อมูลจาก Oracle ได้", details: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) { console.error(err); }
        }
    }
};

/// ⏰ ฟังก์ชันที่ 2: ดึงตารางเรียน (แก้ SQL ใหม่ ดึงจาก EXP_CLASS เป็นหลัก)
exports.getTimetable = async (req, res) => {
    let connection;
    try {
        connection = await database.oracledb.getConnection();
        const keyword = req.query.keyword;
        const semester = req.query.semester || 1; 
        const acadyear = req.query.acadyear || 2569; 
        
        let sqlQuery = `
            SELECT 
                crs.COURSECODE, crs.COURSENAME, crs.COURSEUNIT, c.SECTION,
                CASE ct.WEEKDAY
                    WHEN 1 THEN 'อาทิตย์' WHEN 2 THEN 'จันทร์' WHEN 3 THEN 'อังคาร'
                    WHEN 4 THEN 'พุธ' WHEN 5 THEN 'พฤหัสบดี' WHEN 6 THEN 'ศุกร์'
                    WHEN 7 THEN 'เสาร์' ELSE 'ไม่ระบุ'
                END AS DAY_NAME,
                ts_from.TIMEOF AS START_TIME,
                ts_to.TIMEOF AS END_TIME,
                TO_CHAR(cem.EXAMDATE, 'DD/MM/YYYY') AS MID_DATE,
                TO_CHAR(cem.EXAMTIMEFROM, 'HH24:MI') AS MID_START,
                TO_CHAR(cem.EXAMTIMETO, 'HH24:MI') AS MID_END,
                TO_CHAR(cef.EXAMDATE, 'DD/MM/YYYY') AS FIN_DATE,
                TO_CHAR(cef.EXAMTIMEFROM, 'HH24:MI') AS FIN_START,
                TO_CHAR(cef.EXAMTIMETO, 'HH24:MI') AS FIN_END
            FROM EXP_CLASS c
            JOIN EXP_COURSE crs ON c.COURSEID = crs.COURSEID
            LEFT JOIN EXP_CLASSTIMETABLE ct ON c.CLASSID = ct.CLASSID
            LEFT JOIN EXP_SYSTIMESLOT ts_from ON ct.TIMESLOTFROM = ts_from.TIMESLOT
            LEFT JOIN EXP_SYSTIMESLOT ts_to ON ct.TIMESLOTTO = ts_to.TIMESLOT
            LEFT JOIN EXP_CLASSEXAM cem ON c.CLASSID = cem.CLASSID AND cem.EXAMCODE = 'M'
            LEFT JOIN EXP_CLASSEXAM cef ON c.CLASSID = cef.CLASSID AND cef.EXAMCODE = 'F'
            WHERE c.ACADYEAR = :acadyear AND c.SEMESTER = :semester
        `;

        let bindParams = { acadyear: parseInt(acadyear), semester: parseInt(semester) };

        if (keyword) {
            sqlQuery += ` AND (LOWER(crs.COURSECODE) LIKE LOWER(:keyword) OR LOWER(crs.COURSENAME) LIKE LOWER(:keyword))`;
            bindParams.keyword = `%${keyword}%`;
        }

        const result = await connection.execute(
            sqlQuery, bindParams,
            { outFormat: database.oracledb.OUT_FORMAT_OBJECT, maxRows: 50000 }
        );

        res.status(200).json({ status: "success", total: result.rows.length, data: result.rows });

    } catch (err) {
        console.error("❌ เกิดข้อผิดพลาดในการดึงตารางเรียน:", err);
        res.status(500).json({ error: "ไม่สามารถดึงข้อมูลตารางเรียนได้" });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) {}
        }
    }
};

// 🪄 ฟังก์ชันที่ 3: ดึงแผนการศึกษา (Auto-Recommendation)
exports.getStudyPlan = async (req, res) => {
    let connection;
    try {
        connection = await database.oracledb.getConnection();

        const { major, year, semester } = req.query;

        // 1. ทำความสะอาดชื่อสาขา (ตัดคำว่าหลักสูตรสาขาวิชา และวงเล็บออก)
        let cleanMajor = major || '';
        cleanMajor = cleanMajor.replace(/หลักสูตรสาขาวิชา|สาขาวิชา/g, '').trim();
        // ถ้าเป็น "วิศวกรรมโยธา (นานาชาติ)" ให้เหลือแค่ "วิศวกรรมโยธา" เพื่อหาหลักสูตร
        if (cleanMajor.includes('(')) {
            cleanMajor = cleanMajor.substring(0, cleanMajor.indexOf('(')).trim();
        }

        // 2. คำนวณปีรับเข้า (Admit Year) จากชั้นปี
        const currentAcadYear = 2569; 
        const studentYear = parseInt(year) || 1;
        const admitYear = currentAcadYear - studentYear + 1;

        // 3. Query อัปเกรด: ล็อกชื่อหลักสูตร และดึงปีล่าสุดของสาขานั้น
        const sqlQuery = `
            WITH TargetProgram AS (
                SELECT PROGRAMID FROM EXP_PROGRAM 
                WHERE PROGRAMNAME LIKE :cleanMajor || '-%'
                  AND PROGRAMYEAR <= :admitYear
                  -- กรองไม่ให้ดึงพวก -โทความเป็นผู้ประกอบการ หรือ หลักสูตรอื่นๆ มาปน
                  AND (INSTR(:rawMajor, '(') > 0 OR INSTR(PROGRAMNAME, '(') = 0)
                ORDER BY PROGRAMYEAR DESC FETCH FIRST 1 ROWS ONLY
            )
            SELECT DISTINCT
                c.COURSECODE, 
                c.COURSENAME, 
                c.COURSEUNIT
            FROM EXP_STUDYPLAN sp
            JOIN TargetProgram tp ON sp.PROGRAMID = tp.PROGRAMID
            JOIN EXP_COURSE c ON sp.COURSEID = c.COURSEID
            WHERE sp.STUDENTYEAR = :year 
              AND sp.SEMESTER = :semester
        `;

        const result = await connection.execute(
            sqlQuery,
            { 
                cleanMajor: cleanMajor,
                rawMajor: major || '',
                admitYear: admitYear,
                year: studentYear, 
                semester: parseInt(semester) || 1 
            },
            { outFormat: database.oracledb.OUT_FORMAT_OBJECT }
        );

        res.status(200).json({ status: "success", total: result.rows.length, data: result.rows });

    } catch (err) {
        console.error("❌ เกิดข้อผิดพลาดในการดึงแผนการศึกษา:", err);
        res.status(500).json({ error: "ไม่สามารถดึงแผนการศึกษาได้", details: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) { console.error(err); }
        }
    }
};

// ⭐️ ฟังก์ชันที่ 4: ดึงรายชื่อวิชาทั้งหมดสำหรับหน้ารีวิว
exports.getAllCoursesForReview = async (req, res) => {
    let connection;
    try {
        connection = await database.oracledb.getConnection();
        
        const keyword = req.query.keyword ? req.query.keyword.trim() : ''; 

        const codeKeyword = `${keyword}%`; 
        const nameKeyword = `%${keyword}%`;

        let sqlQuery = `
            SELECT DISTINCT COURSECODE, COURSENAME 
            FROM EXP_COURSE 
            WHERE LOWER(COURSECODE) LIKE LOWER(:codeKeyword) 
               OR LOWER(COURSENAME) LIKE LOWER(:nameKeyword)
            ORDER BY COURSECODE ASC
            FETCH FIRST 50 ROWS ONLY
        `;

        const result = await connection.execute(
            sqlQuery,
            { codeKeyword: codeKeyword, nameKeyword: nameKeyword },
            { outFormat: database.oracledb.OUT_FORMAT_OBJECT }
        );

        res.status(200).json({ status: "success", data: result.rows });

    } catch (err) {
        console.error("❌ Error fetching courses for review:", err);
        res.status(500).json({ error: "ไม่สามารถดึงรายวิชาได้" });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) {}
        }
    }
};

exports.getAllPrograms = async (req, res) => {
    let connection;
    try {
        connection = await database.oracledb.getConnection();
        
        let sqlQuery = `
            SELECT DISTINCT f.FACULTYNAME, p.PROGRAMNAME 
            FROM EXP_PROGRAM p
            JOIN EXP_FACULTY f ON p.FACULTYID = f.FACULTYID
            WHERE p.PROGRAMNAME IS NOT NULL AND f.FACULTYNAME IS NOT NULL
        `;

        const result = await connection.execute(sqlQuery, [], { outFormat: database.oracledb.OUT_FORMAT_OBJECT });

        const groupedData = {};

        result.rows.forEach(row => {
            const faculty = row.FACULTYNAME.trim();
            const rawMajor = row.PROGRAMNAME.trim();

            let cleanMajor = rawMajor.replace(/-\s*\d{4}.*$/, '').trim();

            if (!groupedData[faculty]) {
                groupedData[faculty] = new Set();
            }
            groupedData[faculty].add(cleanMajor);
        });

        const finalData = {};
        for (const key in groupedData) {
            finalData[key] = Array.from(groupedData[key]).sort();
        }

        res.status(200).json({ status: "success", data: finalData });

    } catch (err) {
        console.error("❌ Error fetching programs:", err);
        res.status(500).json({ error: "ไม่สามารถดึงข้อมูลสาขาวิชาได้" });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) {}
        }
    }
};

// ==========================================
// 🚨 [เพิ่มใหม่] ฟังก์ชันที่ 5: API ดึงข้อมูลรายวิชาแบบเจาะจงให้ AI 
// ใช้สำหรับแปลงรหัสวิชาที่ AI ส่งมา (เช่น [COURSES: IF1101]) ให้กลายเป็นข้อมูลตารางพร้อมเวลาเรียน
// ==========================================
exports.getCourseForAI = async (req, res) => {
    let connection;
    try {
        connection = await database.oracledb.getConnection();
        // รับรหัสวิชาที่ส่งมาทางพารามิเตอร์ (เช่น /api/course/IF1101)
        const courseCode = req.params.courseCode;
        
        // ดึงโครงสร้าง SQL เดียวกับ getTimetable มาใช้ แต่ล็อกเงื่อนไขเป็นรหัสวิชาตัวเดียว
        let sqlQuery = `
            SELECT 
                crs.COURSECODE, crs.COURSENAME, crs.COURSEUNIT, c.SECTION,
                CASE ct.WEEKDAY
                    WHEN 1 THEN 'อาทิตย์' WHEN 2 THEN 'จันทร์' WHEN 3 THEN 'อังคาร'
                    WHEN 4 THEN 'พุธ' WHEN 5 THEN 'พฤหัสบดี' WHEN 6 THEN 'ศุกร์'
                    WHEN 7 THEN 'เสาร์' ELSE 'ไม่ระบุ'
                END AS DAY_NAME,
                ts_from.TIMEOF AS START_TIME,
                ts_to.TIMEOF AS END_TIME,
                TO_CHAR(cem.EXAMDATE, 'DD/MM/YYYY') AS MID_DATE,
                TO_CHAR(cem.EXAMTIMEFROM, 'HH24:MI') AS MID_START,
                TO_CHAR(cem.EXAMTIMETO, 'HH24:MI') AS MID_END,
                TO_CHAR(cef.EXAMDATE, 'DD/MM/YYYY') AS FIN_DATE,
                TO_CHAR(cef.EXAMTIMEFROM, 'HH24:MI') AS FIN_START,
                TO_CHAR(cef.EXAMTIMETO, 'HH24:MI') AS FIN_END
            FROM EXP_CLASS c
            JOIN EXP_COURSE crs ON c.COURSEID = crs.COURSEID
            LEFT JOIN EXP_CLASSTIMETABLE ct ON c.CLASSID = ct.CLASSID
            LEFT JOIN EXP_SYSTIMESLOT ts_from ON ct.TIMESLOTFROM = ts_from.TIMESLOT
            LEFT JOIN EXP_SYSTIMESLOT ts_to ON ct.TIMESLOTTO = ts_to.TIMESLOT
            LEFT JOIN EXP_CLASSEXAM cem ON c.CLASSID = cem.CLASSID AND cem.EXAMCODE = 'M'
            LEFT JOIN EXP_CLASSEXAM cef ON c.CLASSID = cef.CLASSID AND cef.EXAMCODE = 'F'
            WHERE UPPER(crs.COURSECODE) = UPPER(:courseCode)
            FETCH FIRST 10 ROWS ONLY
        `;

        const result = await connection.execute(
            sqlQuery, 
            { courseCode: courseCode },
            { outFormat: database.oracledb.OUT_FORMAT_OBJECT }
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "ไม่พบข้อมูลวิชานี้ในตารางเรียน" });
        }

        res.status(200).json({ status: "success", data: result.rows });

    } catch (err) {
        console.error("❌ เกิดข้อผิดพลาดในการดึงข้อมูลสำหรับ AI:", err);
        res.status(500).json({ error: "ไม่สามารถดึงข้อมูลได้" });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) {}
        }
    }
};