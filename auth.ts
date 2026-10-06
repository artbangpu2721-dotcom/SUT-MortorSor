declare var supabase: any;

// เชื่อมต่อฐานข้อมูล
const authSupabaseUrl = 'https://wgeameqajwbvnvzcnxwm.supabase.co';
const authSupabaseKey = 'sb_publishable_-boyi5cXgE9MRC4v261MnQ_j4DCiZ3Q'; // คีย์ของคุณ
const authSupabaseClient = supabase.createClient(authSupabaseUrl, authSupabaseKey);

// ประกาศชนิดของ View ที่สามารถเป็นไปได้
type AuthViewType = 'view-login' | 'view-register' | 'view-forgot';

/**
 * ฟังก์ชันสำหรับสลับหน้าต่างระบบสมาชิก
 * @param viewId รหัสของหน้าต่างเป้าหมาย
 */
function switchAuthView(viewId: AuthViewType): void {
    // ดึง element ของกล่องทั้งหมดที่มีคลาส .auth-view
    const views = document.querySelectorAll('.auth-view') as NodeListOf<HTMLElement>;
    
    // วนลูปเพื่อซ่อนทุกกล่อง
    views.forEach(view => {
        view.classList.remove('active');
    });
    
    // ค้นหากล่องที่ต้องการเปิด และเพิ่มคลาส active เพื่อแสดงผล
    const targetView = document.getElementById(viewId) as HTMLElement | null;
    if (targetView) {
        targetView.classList.add('active');
    }
}

// ตัวดักจับเหตุการณ์ (Event Listeners) เมื่อผู้ใช้กดปุ่ม Submit เพื่อป้องกันการ Reload หน้าเว็บ
document.addEventListener('DOMContentLoaded', () => {
    
    const loginForm = document.getElementById('form-login') as HTMLFormElement;
    const registerForm = document.getElementById('form-register') as HTMLFormElement;
    const forgotForm = document.getElementById('form-forgot') as HTMLFormElement;

    // ==========================================
    // ระบบเข้าสู่ระบบ (Login)
    // ==========================================
    if (loginForm) {
        // เพิ่ม async ตรงนี้เพื่อใช้คำสั่ง await กับ Supabase
        loginForm.addEventListener('submit', async (e: Event) => {
            e.preventDefault();
            
            // ดึงช่อง Input
            const studentIdInput = document.getElementById('login-studentid') as HTMLInputElement;
            const passwordInput = loginForm.querySelector('input[type="password"]') as HTMLInputElement;
            
            // แปลงรหัสนักศึกษาให้เป็นรูปแบบอีเมล
            const studentId = studentIdInput.value.toUpperCase();
            const emailToLogin = `${studentId.toLowerCase()}@g.sut.ac.th`;

            // ส่งคำขอเข้าสู่ระบบไปยัง Supabase (ใช้ authSupabaseClient)
            const { data, error } = await authSupabaseClient.auth.signInWithPassword({
                email: emailToLogin,
                password: passwordInput.value
            });

            if (error) {
                alert('รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง');
            } else {
                // เข้าสู่ระบบสำเร็จ เด้งไปหน้าหลัก
                window.location.href = 'index.html';
            }
        });
    }

    // ==========================================
    // ระบบสมัครสมาชิก (Register)
    // ==========================================
    if (registerForm) {
        // เพิ่ม async ตรงนี้เช่นกัน
        registerForm.addEventListener('submit', async (e: Event) => {
            e.preventDefault();
            
            // ดึงค่าจากฟอร์มสมัคร
            const inputs = registerForm.querySelectorAll('input');
            const studentId = inputs[0].value.toUpperCase();
            const email = inputs[1].value;
            const password = inputs[2].value;

            // ส่งข้อมูลไปบันทึกลง Supabase (ใช้ authSupabaseClient)
            const { data, error } = await authSupabaseClient.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        student_id: studentId, // เก็บข้อมูลรหัสนักศึกษาแนบไปกับโปรไฟล์
                    }
                }
            });

            if (error) {
                alert(`เกิดข้อผิดพลาด: ${error.message}`);
            } else {
                alert('สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบ');
                switchAuthView('view-login'); // เด้งกลับหน้า Login
                registerForm.reset(); // ล้างข้อมูลในฟอร์ม
            }
        });
    }

    // ==========================================
    // ระบบลืมรหัสผ่าน (Forgot Password)
    // ==========================================
    if (forgotForm) {
        forgotForm.addEventListener('submit', (e: Event) => {
            e.preventDefault();
            alert('ระบบได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลของคุณแล้ว');
            switchAuthView('view-login'); // เด้งกลับหน้า Login
        });
    }

});