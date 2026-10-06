const OpenAI = require("openai");

const API_KEY = "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";
const openai = new OpenAI({
    apiKey: API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
});

async function runTest() {
    console.log("⏳ กำลังจำลองการจัดตารางเรียน...");
    try {
        const response = await openai.chat.completions.create({
            model: "qwen/qwen3.8-27b", // ล็อกชื่อโมเดลที่ใช้งานได้ไว้เลย
            max_tokens: 800, // จำกัดไม่ให้เกิน 1,000 โทเคน เพื่อแก้ Error 429
            messages: [
                { role: "system", content: "คุณคือระบบ AI มทส. โปรดตอบกลับเป็นรูปแบบ JSON เท่านั้น" },
                { role: "user", content: "จัดตารางเรียน 1 วิชาพร้อมรหัสวิชา" }
            ],
            response_format: { type: "json_object" } // บังคับโครงสร้างเป็น JSON
        });

        console.log("🎉 เชื่อมต่อสำเร็จเด็ดขาด! ข้อมูลตารางเรียนที่ได้:");
        console.log(response.choices[0].message.content);

    } catch (error) {
        console.error("\n❌ การเชื่อมต่อล้มเหลว:", error.message);
    }
}

runTest();