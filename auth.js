"use strict";

// ==========================================
// 1. ตั้งค่าการเชื่อมต่อ Supabase
// ==========================================
const supabaseUrl = 'https://wgeameqajwbvnvzcnxwm.supabase.co'; 
const supabaseKey = 'sb_publishable_-boyi5cXgE9MRC4v261MnQ_j4DCiZ3Q'; 
// 🚀 แก้ไข: เปลี่ยนชื่อเป็น supabaseClient เพื่อไม่ให้ชนกับระบบ
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// ==========================================
// ฟังก์ชันสลับหน้าต่าง (Login / Register / Forgot)
// ==========================================
function switchAuthView(viewId) {
    const views = document.querySelectorAll('.auth-view');
    views.forEach(view => view.classList.remove('active'));
    const targetView = document.getElementById(viewId);
    if (targetView) targetView.classList.add('active');
}

// ==========================================
// ฟังก์ชันสลับการแสดงผลรหัสผ่าน (เปิด/ปิดตา)
// ==========================================
function togglePassword(inputId, iconId) {
    const passwordInput = document.getElementById(inputId);
    const toggleIcon = document.getElementById(iconId);

    if (!passwordInput || !toggleIcon) return;

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleIcon.classList.remove('fa-eye');
        toggleIcon.classList.add('fa-eye-slash');
    } else {
        passwordInput.type = 'password';
        toggleIcon.classList.remove('fa-eye-slash');
        toggleIcon.classList.add('fa-eye');
    }
}

// ==========================================
// 2. ระบบดึงข้อมูล สำนัก/สาขา จาก Oracle
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    const facultySelect = document.getElementById('register-faculty');
    const majorSelect = document.getElementById('register-major');
    
    let universityData = {}; 

    if (facultySelect && majorSelect) {
        try {
            // 🔥 แก้ไข: เติม /api/programs ให้สมบูรณ์
            const response = await fetch('https://genome-critics-vid-dylan.trycloudflare.com/api/programs');
            const result = await response.json();
            
            if (result.status === 'success') {
                universityData = result.data;
                
                if (Array.isArray(universityData)) {
                    facultySelect.innerHTML = '<option value="" disabled selected>⚠️ กรุณารีสตาร์ทเซิร์ฟเวอร์ Backend ครับ!</option>';
                    return;
                }

                facultySelect.innerHTML = '<option value="" disabled selected>-- เลือกสำนักวิชาของคุณ --</option>';
                Object.keys(universityData).sort().forEach(faculty => {
                    const option = document.createElement('option');
                    option.value = faculty;
                    option.textContent = faculty;
                    facultySelect.appendChild(option);
                });

                facultySelect.addEventListener('change', function() {
                    const selectedFaculty = this.value;
                    majorSelect.disabled = false;
                    majorSelect.innerHTML = '<option value="" disabled selected>-- เลือกสาขาวิชาของคุณ --</option>';
                    
                    const majors = universityData[selectedFaculty] || [];
                    majors.forEach(major => {
                        const option = document.createElement('option');
                        option.value = major;
                        option.textContent = major;
                        majorSelect.appendChild(option);
                    });
                });
            } else {
                facultySelect.innerHTML = `<option value="" disabled selected>❌ ${result.error}</option>`;
            }
        } catch (error) {
            console.error("Error loading programs:", error);
            facultySelect.innerHTML = '<option value="" disabled selected>❌ โหลดข้อมูลล้มเหลว โปรดตรวจสอบ Backend</option>';
        }
    }
});

// ==========================================
// 3. ระบบสมัครสมาชิก & เข้าสู่ระบบ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('form-login');
    const registerForm = document.getElementById('form-register');
    const forgotForm = document.getElementById('form-forgot');
    
    // 🚀 ระบบเข้าสู่ระบบ (Mock Login ไปก่อน)
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const inputField = document.getElementById('login-studentid');
            let studentId = inputField.value.trim().toUpperCase();

            if (!studentId) {
                alert('กรุณากรอกรหัสนักศึกษาครับ');
                return; 
            }
            
            localStorage.setItem('sut_student_id', studentId);
            window.location.href = 'index.html';
        });
    }
    
    // 🚀 ระบบสมัครสมาชิก (เชื่อมต่อ Supabase จริง!)
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = registerForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerText;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังสร้างบัญชี...';
            submitBtn.disabled = true;

            const studentId = document.getElementById('reg-studentid').value.trim().toUpperCase();
            const firstName = document.getElementById('reg-firstname').value.trim();
            const lastName = document.getElementById('reg-lastname').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const password = document.getElementById('reg-password').value;
            const faculty = document.getElementById('register-faculty').value;
            const major = document.getElementById('register-major').value;

            try {
                // ใช้ supabaseClient แทน supabase
                const { data: authData, error: authError } = await supabaseClient.auth.signUp({
                    email: email,
                    password: password,
                });

                if (authError) throw authError;

                const { error: profileError } = await supabaseClient
                    .from('profiles')
                    .insert([
                        { 
                            student_id: studentId,
                            first_name: firstName,
                            last_name: lastName,
                            faculty: faculty,
                            major: major 
                        }
                    ]);

                if (profileError) throw profileError;

                alert('✅ สมัครสมาชิกสำเร็จ!');
                
                registerForm.reset();
                switchAuthView('view-login');
                const loginStudentIdInput = document.getElementById('login-studentid');
                if(loginStudentIdInput) loginStudentIdInput.value = studentId;

            } catch (error) {
                console.error("Signup error:", error);
                alert(`❌ เกิดข้อผิดพลาด: ${error.message}`);
            } finally {
                submitBtn.innerText = originalText;
                submitBtn.disabled = false;
            }
        });
    }
    
    // ระบบลืมรหัสผ่าน (จำลอง)
    if (forgotForm) {
        forgotForm.addEventListener('submit', (e) => {
            e.preventDefault();
            alert('ระบบกำลังอยู่ในช่วงพัฒนาครับ');
        });
    }
});