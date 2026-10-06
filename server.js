require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai'); // ไลบรารี OpenAI สำหรับต่อ Groq
const database = require('./src/config/oracle'); 
const apiRoutes = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); 
app.use(express.json()); 
app.use('/api', apiRoutes);

const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY, 
    baseURL: "https://api.groq.com/openai/v1",
});

async function startup() {
    console.log(`\n=========================================`);
    console.log(`กำลังบูตระบบ SUT MortorSor Backend...`);
    await database.initialize();
    const server = app.listen(PORT, () => {
        console.log(`🚀 เซิร์ฟเวอร์รันสำเร็จที่ http://localhost:${PORT}`);
        console.log(`⏳ กำลังสแตนด์บายรอรับคำสั่งจากหน้าเว็บ...`);
        console.log(`=========================================\n`);
    });
    server.on('error', (error) => {
        console.error(`\n❌ เซิร์ฟเวอร์พัง! สาเหตุ: ${error.message}\n`);
    });
}

app.post('/api/aichat', async (req, res) => {
    try {
        const { message, major, year, semester, history } = req.body;
        
       // 1. สกัดชื่อสาขาให้เหลือแค่ชื่อเต็มๆ (เอาโค้ดตัดวงเล็บเดิมออก เพื่อไม่ให้สาขานานาชาติพัง)
        let cleanMajor = major || 'ไม่ระบุ';
        cleanMajor = cleanMajor.replace(/หลักสูตรสาขาวิชา|สาขาวิชา/g, '').trim();

        const connection = await database.oracledb.getConnection();
        
        // 2. Query แผนการเรียน 4 ปี (ดึงปีล่าสุดของสาขาที่เลือกเป๊ะๆ)
        const sqlFullPlan = `
            WITH TargetProgram AS (
                SELECT PROGRAMID FROM EXP_PROGRAM 
                -- บังคับให้รูปแบบเป็น "ชื่อสาขา-..." เท่านั้น เพื่อไม่ให้ดึงสาขาชื่อคล้ายกันมาปน
                WHERE PROGRAMNAME LIKE :cleanMajor || '-%' 
                  -- ถ้าสาขาที่เลือกไม่มีวงเล็บ ก็จะไม่ดึงหลักสูตรที่มีวงเล็บ (เช่น นานาชาติ) มาปนเด็ดขาด
                  AND (INSTR(:cleanMajor, '(') > 0 OR INSTR(PROGRAMNAME, '(') = 0)
                ORDER BY PROGRAMYEAR DESC FETCH FIRST 1 ROWS ONLY
            )
            SELECT sp.STUDENTYEAR, sp.SEMESTER, c.COURSECODE, c.COURSENAME 
            FROM EXP_STUDYPLAN sp
            JOIN TargetProgram tp ON sp.PROGRAMID = tp.PROGRAMID
            JOIN EXP_COURSE c ON sp.COURSEID = c.COURSEID
            ORDER BY sp.STUDENTYEAR ASC, sp.SEMESTER ASC, c.COURSECODE ASC
        `;

        // 3. Query รายวิชาสาขาที่เปิดสอน
        const sqlMajor = `
            WITH TargetProgram AS (
                SELECT PROGRAMID FROM EXP_PROGRAM 
                WHERE PROGRAMNAME LIKE :cleanMajor || '-%' 
                  AND (INSTR(:cleanMajor, '(') > 0 OR INSTR(PROGRAMNAME, '(') = 0)
                ORDER BY PROGRAMYEAR DESC FETCH FIRST 1 ROWS ONLY
            ),
            PlanCourses AS (
                SELECT DISTINCT sp.COURSEID FROM EXP_STUDYPLAN sp
                JOIN TargetProgram tp ON sp.PROGRAMID = tp.PROGRAMID
                WHERE sp.STUDENTYEAR = :year AND sp.SEMESTER = :semester
            ),
            RankedClasses AS (
                SELECT c.COURSECODE, c.COURSENAME, cl.SECTION, t.WEEKDAY, t.TIMESLOTFROM, t.TIMESLOTTO,
                       ROW_NUMBER() OVER (PARTITION BY c.COURSECODE ORDER BY cl.SECTION) as rn
                FROM EXP_COURSE c
                JOIN EXP_CLASS cl ON c.COURSEID = cl.COURSEID
                LEFT JOIN EXP_CLASSTIMETABLE t ON cl.CLASSID = t.CLASSID
                JOIN PlanCourses pc ON c.COURSEID = pc.COURSEID
                WHERE cl.ACADYEAR = 2569 AND cl.SEMESTER = :semester
            )
            SELECT COURSECODE, COURSENAME, SECTION, 
                CASE WEEKDAY WHEN 1 THEN 'อาทิตย์' WHEN 2 THEN 'จันทร์' WHEN 3 THEN 'อังคาร' WHEN 4 THEN 'พุธ' WHEN 5 THEN 'พฤหัสบดี' WHEN 6 THEN 'ศุกร์' WHEN 7 THEN 'เสาร์' ELSE 'รอประกาศ' END AS DAY_NAME,
                NVL(TO_CHAR(TRUNC(SYSDATE) + ((TIMESLOTFROM - 1) * 5) / 1440, 'HH24:MI'), 'TBD') AS START_TIME,
                NVL(TO_CHAR(TRUNC(SYSDATE) + ((TIMESLOTTO - 1) * 5) / 1440, 'HH24:MI'), 'TBD') AS END_TIME
            FROM RankedClasses WHERE rn <= 2
        `;

        // 4. Query วิชาศึกษาทั่วไป (GenEd) - ใช้เหมือนเดิม
        const sqlGenEd = `
            WITH RankedClasses AS (
                SELECT c.COURSECODE, c.COURSENAME, cl.SECTION, t.WEEKDAY, t.TIMESLOTFROM, t.TIMESLOTTO,
                       ROW_NUMBER() OVER (PARTITION BY c.COURSECODE ORDER BY cl.SECTION) as rn
                FROM EXP_COURSE c
                JOIN EXP_CLASS cl ON c.COURSEID = cl.COURSEID
                LEFT JOIN EXP_CLASSTIMETABLE t ON cl.CLASSID = t.CLASSID
                WHERE cl.ACADYEAR = 2569 AND cl.SEMESTER = :semester
                  AND (UPPER(c.COURSECODE) LIKE 'IST%' OR UPPER(c.COURSECODE) LIKE 'LNG%' 
                       OR UPPER(c.COURSECODE) LIKE 'HSS%' OR UPPER(c.COURSECODE) LIKE 'SUT%')
            )
            SELECT COURSECODE, COURSENAME, SECTION, 
                CASE WEEKDAY WHEN 1 THEN 'อาทิตย์' WHEN 2 THEN 'จันทร์' WHEN 3 THEN 'อังคาร' WHEN 4 THEN 'พุธ' WHEN 5 THEN 'พฤหัสบดี' WHEN 6 THEN 'ศุกร์' WHEN 7 THEN 'เสาร์' ELSE 'รอประกาศ' END AS DAY_NAME,
                NVL(TO_CHAR(TRUNC(SYSDATE) + ((TIMESLOTFROM - 1) * 5) / 1440, 'HH24:MI'), 'TBD') AS START_TIME,
                NVL(TO_CHAR(TRUNC(SYSDATE) + ((TIMESLOTTO - 1) * 5) / 1440, 'HH24:MI'), 'TBD') AS END_TIME
            FROM RankedClasses WHERE rn <= 2 FETCH FIRST 25 ROWS ONLY
        `;

        const [majorResult, genedResult, fullPlanResult] = await Promise.all([
            connection.execute(sqlMajor, { cleanMajor, year: parseInt(year)||1, semester: parseInt(semester)||1 }),
            connection.execute(sqlGenEd, { semester: parseInt(semester)||1 }),
            connection.execute(sqlFullPlan, { cleanMajor })
        ]);
        
        await connection.close();

        let fullPlanString = "--- 🗺️ แผนการเรียนตลอดหลักสูตร (อ้างอิงเฉยๆ) ---\n";
        if(fullPlanResult.rows.length === 0) fullPlanString += "(ไม่มีข้อมูล)\n";
        let currentPlanYear = 0;
        fullPlanResult.rows.forEach(r => {
            if(currentPlanYear !== r.STUDENTYEAR) {
                fullPlanString += `\n> ปี ${r.STUDENTYEAR} <\n`;
                currentPlanYear = r.STUDENTYEAR;
            }
            fullPlanString += `- เทอม ${r.SEMESTER}: ${r.COURSECODE} ${r.COURSENAME}\n`;
        });

        // 🔥 ปรับแก้ Format ของ Data ให้ AI อ่านง่ายและนำไปสร้างโค้ดปุ่มได้เป๊ะ 100%
        let dataString = "--- 📅 วิชาที่เปิดสอนจริงและเวลาเรียน (อ้างอิงสร้างปุ่มจัดตาราง) ---\n";
        dataString += "รูปแบบ: รหัสวิชา | ชื่อวิชา | กลุ่ม | วัน | เริ่ม | จบ\n";
        
        if(majorResult.rows.length === 0) dataString += "(ไม่มีวิชาสาขาเปิดสอน)\n";
        majorResult.rows.forEach(r => {
            // จัด Format ให้เหมือนกับที่ AI ต้องคายออกมาเป๊ะๆ
            dataString += `${r.COURSECODE} | ${r.COURSENAME} | ${r.SECTION} | ${r.DAY_NAME} | ${r.START_TIME} | ${r.END_TIME}\n`;
        });

        dataString += "\n";
        genedResult.rows.forEach(r => {
            dataString += `${r.COURSECODE} | ${r.COURSENAME} | ${r.SECTION} | ${r.DAY_NAME} | ${r.START_TIME} | ${r.END_TIME}\n`;
        });

     // ในไฟล์ฝั่ง Backend (API ที่ใช้คุยกับ Gemini/Groq)
        const systemInstruction = `
คุณคือ "SUT AI Advisor" เป็นที่ปรึกษาด้านการวางแผนการเรียนแบบมืออาชีพสำหรับนักศึกษามหาวิทยาลัยเทคโนโลยีสุรนารี (มทส.)

บุคลิกภาพ:
1. แทนตัวเองว่า "ผม" และเรียกผู้ใช้งานว่า "คุณ" เสมอ
2. สุภาพ เป็นมืออาชีพ วิเคราะห์เก่ง ให้เหตุผลประกอบการแนะนำเสมอ

กฎเหล็กขั้นเด็ดขาด (CRITICAL RULES - ต้องทำตามอย่างเคร่งครัด):
1. ห้ามสร้างหรือวาดตารางด้วย Markdown (เช่น | วัน | เวลา | รหัส |) เด็ดขาด ให้อธิบายเป็นข้อความ Bullet point สั้นๆ พอ
2. ทันทีที่ผู้ใช้พิมพ์คำว่า "จัดให้หน่อย", "เอาลงตาราง", "จัดตาราง" หรือแสดงความต้องการให้ระบบจัดตารางให้ คุณต้องสรุปคำตอบสั้นๆ และ **บังคับให้แทรกแท็ก [COURSES: ...] ไว้ที่บรรทัดล่างสุดของคำตอบเสมอ**
3. รูปแบบแท็กบังคับ: [COURSES: รหัสวิชา|กลุ่ม, รหัสวิชา|กลุ่ม] (ระบุแค่รหัสวิชาและกลุ่มเรียนพอ ไม่ต้องระบุเวลาเรียน เพราะระบบหน้าเว็บจะดึงข้อมูลเวลาเอง)
4. หากไม่พบแผนการเรียนในระบบ ให้แนะนำวิชาพื้นฐานจากรายชื่อวิชาที่เปิดสอนแทน อย่าตอบว่า "ไม่ทราบ" เฉยๆ

ตัวอย่างการตอบเมื่อผู้ใช้สั่งให้ลงตาราง:
"ผมได้เลือกวิชาในเทอมนี้ให้คุณเรียบร้อยแล้วครับ โดยจัดเวลาไม่ให้ชนกันเลยดังนี้ครับ:
- SCI03 1001 แคลคูลัส 1
- DGT00 0110 การรู้สารสนเทศและสื่อดิจิทัล

คลิกปุ่มด้านล่างเพื่อเพิ่มวิชาเหล่านี้ลงตารางของคุณได้เลยครับ
[COURSES: SCI031001|1, DGT000110|1]"

ข้อมูลวิชาที่ต้องเรียนตามหลักสูตร (${cleanMajor}):
${JSON.stringify(fullPlanResult.rows)}

ข้อมูลรายวิชาที่เปิดสอนเทอมนี้:
${JSON.stringify(majorResult.rows)}
`;
        const aiMessages = [{ role: "system", content: systemInstruction }];
        if (history && Array.isArray(history)) {
            aiMessages.push(...history.slice(-6));
        }
        aiMessages.push({ role: "user", content: message });

        const response = await openai.chat.completions.create({
            model: "qwen/qwen3.8-27b",
            temperature: 0.1, 
            max_tokens: 800, 
            messages: aiMessages
        });

        const aiResponse = response.choices[0].message.content;
        res.status(200).json({ status: "success", reply: aiResponse });

    } catch (error) {
        console.error("❌ AI Chat Request Failed:", error);
        res.status(500).json({ error: "เซิร์ฟเวอร์ไม่สามารถติดต่อระบบ AI ได้" });
    }
});

startup();