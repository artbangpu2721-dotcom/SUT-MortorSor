const classColors = ['#FF4C4C', '#8E44AD', '#16A085', '#F39C12', '#E67E22', '#2980B9'];
const courseColorMap = {};

// ฟังก์ชันจัดรูปแบบรหัสวิชาให้อ่านง่าย (เช่น IST301101 -> IST30 1101)
window.formatCourseCodeDisplay = function(code) {
    if (!code) return "";
    let cleanCode = code.replace(/\s+/g, '').toUpperCase();
    // เอาสัญลักษณ์ ^ และ $ ออก เพื่อให้จับคู่เว้นวรรคได้แม้จะมีคำว่า (G.1) ต่อท้าย
    return cleanCode.replace(/([A-Z]{3}\d{2})(\d{4})/, '$1 $2').replace(/\(G\./, ' (G.');
};

// ==========================================
// 1. เชื่อมต่อฐานข้อมูล Supabase 
// ==========================================
const supabaseUrl = 'https://wgeameqajwbvnvzcnxwm.supabase.co';
const supabaseKey = 'sb_publishable_-boyi5cXgE9MRC4v261MnQ_j4DCiZ3Q';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

let currentYearLevel = 1;
let currentSemester = 1;
let selectedMajor = "";

let selectedCourseIds = []; 
let allCourses = [];      
let masterCourses = [];   
let selectedCoursesData = []; 
let scheduleCache = {}; 

// ==========================================
// 🔧 ตัวช่วย Normalize ข้อมูลจาก API / Database
// ==========================================
const firstValue = (obj, keys, fallback = '') => {
    for (const key of keys) {
        if (obj && obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== '') {
            return obj[key];
        }
    }
    return fallback;
};

const normalizeCourseCodeKey = (value) => String(value ?? '').replace(/\s+/g, '').toUpperCase();

const normalizeDayName = (value) => {
    if (value === undefined || value === null) return '-';
    const raw = String(value).trim();
    if (!raw || raw === '-') return '-';

    const key = raw.toUpperCase().replace(/\./g, '');
    const dayMap = {
        'MON': 'จันทร์', 'MONDAY': 'จันทร์', '1': 'จันทร์',
        'TUE': 'อังคาร', 'TUES': 'อังคาร', 'TUESDAY': 'อังคาร', '2': 'อังคาร',
        'WED': 'พุธ', 'WEDNESDAY': 'พุธ', '3': 'พุธ',
        'THU': 'พฤหัสบดี', 'THUR': 'พฤหัสบดี', 'THURS': 'พฤหัสบดี', 'THURSDAY': 'พฤหัสบดี', '4': 'พฤหัสบดี',
        'FRI': 'ศุกร์', 'FRIDAY': 'ศุกร์', '5': 'ศุกร์',
        'SAT': 'เสาร์', 'SATURDAY': 'เสาร์', '6': 'เสาร์',
        'SUN': 'อาทิตย์', 'SUNDAY': 'อาทิตย์', '7': 'อาทิตย์'
    };
    return dayMap[key] || raw;
};

const normalizeTime = (value) => {
    if (value === undefined || value === null) return '';
    let raw = String(value).trim();
    if (!raw || raw === '-') return '';
    const isoMatch = raw.match(/T(\d{1,2}):(\d{2})/);
    if (isoMatch) return `${isoMatch[1].padStart(2, '0')}:${isoMatch[2]}`;
    const colonMatch = raw.match(/^(\d{1,2})[:.](\d{2})/);
    if (colonMatch) return `${colonMatch[1].padStart(2, '0')}:${colonMatch[2]}`;
    if (/^\d{3,4}$/.test(raw)) return `${raw.padStart(4, '0')}${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
    if (/^\d{1,2}$/.test(raw)) return `${raw.padStart(2, '0')}:00`;
    return raw;
};

const getCourseCode = (c) => String(firstValue(c, ['COURSECODE', 'COURSE_CODE', 'coursecode'], '')).trim();
const getCourseName = (c) => String(firstValue(c, ['COURSENAME', 'COURSE_NAME', 'coursename'], '')).trim();
const getCourseNameEng = (c) => String(firstValue(c, ['COURSENAME_ENG', 'COURSE_NAME_ENG'], '')).trim();
const getDay = (c) => normalizeDayName(firstValue(c, ['DAY_NAME', 'DAYNAME', 'WEEKDAY'], '-'));
const getStart = (c) => normalizeTime(firstValue(c, ['START_TIME', 'STARTTIME', 'TIMEFROM'], ''));
const getEnd = (c) => normalizeTime(firstValue(c, ['END_TIME', 'ENDTIME', 'TIMETO'], ''));
const getCredit = (c) => firstValue(c, ['COURSEUNIT', 'COURSE_UNIT', 'CREDIT', 'courseunit'], '0');
const getSection = (c) => String(firstValue(c, ['SECTION', 'SECTION_NO', 'SECTIONNO', 'SEC', 'GROUP_NO'], '1')).trim();
const getMidDate = (c) => firstValue(c, ['MID_DATE', 'mid_date', 'MIDDATE'], '');
const getMidStart = (c) => normalizeTime(firstValue(c, ['MID_START', 'mid_start'], ''));
const getMidEnd = (c) => normalizeTime(firstValue(c, ['MID_END', 'mid_end'], ''));
const getFinDate = (c) => firstValue(c, ['FIN_DATE', 'fin_date', 'FINDATE'], '');
const getFinStart = (c) => normalizeTime(firstValue(c, ['FIN_START', 'fin_start'], ''));
const getFinEnd = (c) => normalizeTime(firstValue(c, ['FIN_END', 'fin_end'], ''));

function normalizeCourseRow(row = {}) {
    return {
        ...row,
        COURSECODE: getCourseCode(row), COURSENAME: getCourseName(row), COURSENAME_ENG: getCourseNameEng(row),
        COURSEUNIT: getCredit(row), SECTION: getSection(row), DAY_NAME: getDay(row), START_TIME: getStart(row), END_TIME: getEnd(row),
        MID_DATE: getMidDate(row), MID_START: getMidStart(row), MID_END: getMidEnd(row), FIN_DATE: getFinDate(row), FIN_START: getFinStart(row), FIN_END: getFinEnd(row)
    };
}

function extractRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    const preferredKeys = ['data', 'rows', 'results', 'items', 'timetable', 'schedules', 'courses'];
    for (const key of preferredKeys) {
        if (Array.isArray(payload[key])) return payload[key];
        if (payload[key] && typeof payload[key] === 'object') {
            const nested = extractRows(payload[key]);
            if (nested.length) return nested;
        }
    }
    return [];
}

function showSuccessModal(title, desc) {
    document.getElementById('success-alert-title').innerText = title;
    document.getElementById('success-alert-desc').innerText = desc;
    document.getElementById('modal-success-alert').style.display = 'flex';
}

// ==========================================
// 2. ฟังก์ชันดึงข้อมูลวิชาหลัก
// ==========================================
async function fetchCourses() {
    try {
        const timetableUrl = `https://transfer-matcher-cable.ngrok-free.dev/api/timetable?acadyear=2569&semester=${currentSemester}`;
        const response = await fetch(timetableUrl);

        if (response.ok) {
            const result = await response.json();
            allCourses = extractRows(result).map(normalizeCourseRow).filter(c => c.COURSECODE);
        } else {
            allCourses = [];
        }

        if (masterCourses.length === 0) {
            const masterRes = await fetch(`https://transfer-matcher-cable.ngrok-free.dev/api/courses`);
            if (masterRes.ok) {
                const masterResult = await masterRes.json();
                masterCourses = extractRows(masterResult).map(normalizeCourseRow).filter(c => c.COURSECODE);
            }
        }
        
        setupCourseSearch('search-major', 'courses-major');
        setupCourseSearch('search-free', 'courses-free');
        setupCourseSearch('search-gen', 'courses-gen');
    } catch (error) {
        console.error('❌ เกิดข้อผิดพลาดในการดึงข้อมูล:', error);
        allCourses = [];
    }
}

// ==========================================
// 3. ควบคุมเมื่อโหลดหน้าเว็บ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    fetchStudentProfileOnLogin();

    document.querySelectorAll('.year-tab').forEach((tab, index) => {
        tab.addEventListener('click', function() {
            const oldKey = `${currentYearLevel}_${currentSemester}`;
            scheduleCache[oldKey] = { 
                ids: JSON.parse(JSON.stringify(selectedCourseIds)), 
                data: JSON.parse(JSON.stringify(selectedCoursesData)) 
            };

            document.querySelectorAll('.year-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            currentYearLevel = index + 1; 
            loadSchedule(); 
        });
    });

    checkUserSession(); 

    const saveProfileBtn = document.getElementById('save-profile-btn');
    if (saveProfileBtn) saveProfileBtn.addEventListener('click', saveProfile);
    const saveScheduleBtn = document.getElementById('save-schedule-btn');
    if (saveScheduleBtn) saveScheduleBtn.addEventListener('click', saveSchedule);
    const autoPlanBtn = document.getElementById('auto-plan-btn');
    if (autoPlanBtn) autoPlanBtn.addEventListener('click', handleAutoRecommend);

    initReviewSystem();

    fetchCourses().then(() => {
        if (typeof updateSelectedCoursesCart === 'function') updateSelectedCoursesCart();
    });

    if(typeof window.setupCustomCourseAutocomplete === 'function'){
        window.setupCustomCourseAutocomplete();
    }
});
async function fetchStudentProfileOnLogin() {
    const loggedInStudentId = localStorage.getItem('sut_student_id') || '';
    
    if (loggedInStudentId) {
        if (document.getElementById('display-student-id')) document.getElementById('display-student-id').innerText = loggedInStudentId;
        if (document.getElementById('display-profile-name')) document.getElementById('display-profile-name').innerText = loggedInStudentId;

        const yearMatch = loggedInStudentId.match(/[a-zA-Z](\d{2})/);
        if (yearMatch) {
            const admitYear = 2500 + parseInt(yearMatch[1]);
            const currentYear = new Date().getFullYear() + 543;
            let calculated = currentYear - admitYear + 1;
            let yearStr = calculated > 0 ? calculated.toString() : '1';
            if(document.getElementById('profile-year-level')) document.getElementById('profile-year-level').value = `${yearStr}`;
            currentYearLevel = parseInt(yearStr); // อัปเดตตัวแปรกลางด้วย
        }

        // โหลดภาพพื้นหลังและรูปโปรไฟล์ที่เคยบันทึกไว้ขึ้นมาแสดงทันที
        const savedBg = localStorage.getItem(`sut_bg_${loggedInStudentId}`);
        if (savedBg) {
            const bgContainer = document.getElementById('profile-bg-container');
            if (bgContainer) {
                bgContainer.style.backgroundImage = `url(${savedBg})`;
                bgContainer.style.backgroundSize = 'cover';
                bgContainer.style.backgroundPosition = 'center';
            }
        }

        const savedAvatar = localStorage.getItem(`sut_avatar_${loggedInStudentId}`);
        if (savedAvatar) {
            const avatarImg = document.getElementById('profile-avatar-img');
            const defaultIcon = document.getElementById('default-avatar-icon');
            if (avatarImg && defaultIcon) {
                avatarImg.src = savedAvatar;
                avatarImg.style.display = 'block';
                defaultIcon.style.display = 'none';
            }
        }
    }

    try {
        if (!loggedInStudentId) return;

        const { data, error } = await supabaseClient.from('profiles').select('*').eq('student_id', loggedInStudentId).maybeSingle();
        
        if (data) {
            const fullName = `${data.first_name || ''} ${data.last_name || ''}`.trim();
            if(document.getElementById('profile-fullname')) document.getElementById('profile-fullname').value = fullName;
            if(document.getElementById('display-profile-name')) document.getElementById('display-profile-name').innerText = fullName || loggedInStudentId;
            if(document.getElementById('profile-faculty')) document.getElementById('profile-faculty').value = data.faculty || '';
            if(document.getElementById('profile-major')) document.getElementById('profile-major').value = data.major || '';

            // เก็บค่าสาขาไว้ใช้ส่งหา AI
            selectedMajor = data.major || '';

            if(document.getElementById('profile-age')) document.getElementById('profile-age').value = data.age || '';
            if(document.getElementById('profile-freetime')) document.getElementById('profile-freetime').value = data.free_time || '';
            if(document.getElementById('profile-mbti')) document.getElementById('profile-mbti').value = data.mbti || '';
            if(document.getElementById('profile-learning-style')) document.getElementById('profile-learning-style').value = data.learning_style || '';
            if(document.getElementById('profile-social')) document.getElementById('profile-social').value = data.social_media || '';
        } else {
            // 🔥 ป้องกันบัคบัญชีใหม่: ถ้าดึงข้อมูลไม่ได้ ให้พยายามดูดค่าจากหน้าจอมาใช้ก่อน
            const screenMajor = document.getElementById('profile-major');
            if (screenMajor && screenMajor.value && screenMajor.value !== 'ดึงข้อมูลจากระบบ...') {
                selectedMajor = screenMajor.value;
            } else {
                // ถ้าหน้าจอก็ว่าง ให้ตั้งค่า Default ที่จะทำให้ระบบไม่พัง
                selectedMajor = "วิศวกรรมคอมพิวเตอร์"; // ตัวอย่างค่าตั้งต้น เผื่อผู้ใช้ไม่ยอมกรอก
            }
        }
    } catch (error) {
        console.error("Profile load error:", error);
    }
}
// ==========================================
// 🔄 ฟังก์ชันสลับหน้าเว็บ (อัปเกรดให้รองรับการล้างโหมดโปรไฟล์เพื่อน)
// ==========================================
window.switchPage = function(pageId, menuItem) {
    // ดักจับ: ถ้ากำลังดูโปรไฟล์เพื่อนอยู่ แล้วกดเมนูไปหน้าอื่น ให้คืนค่าหน้าโปรไฟล์เป็นของตัวเองทันที
    if (typeof restoreMyProfile === 'function') {
        restoreMyProfile(); 
    }
    
    // โค้ดสลับหน้าเว็บแบบเดิม
    document.querySelectorAll('.page-view').forEach(page => { page.style.display = 'none'; page.classList.remove('active'); });
    const targetPage = document.getElementById(pageId);
    if (targetPage) { targetPage.style.display = 'block'; targetPage.classList.add('active'); }
    
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    if (menuItem) menuItem.classList.add('active');
    
    if (pageId === 'community-chat') loadChatRooms();
};

window.changeSemester = async function(direction) {
    const oldKey = `${currentYearLevel}_${currentSemester}`;
    scheduleCache[oldKey] = { 
        ids: JSON.parse(JSON.stringify(selectedCourseIds)), 
        data: JSON.parse(JSON.stringify(selectedCoursesData)) 
    };

    currentSemester += direction;
    if (currentSemester > 3) currentSemester = 1; 
    if (currentSemester < 1) currentSemester = 3; 
    
    document.getElementById('semester-text').innerText = `เทอมที่ ${currentSemester}`;
    
    await fetchCourses();
    loadSchedule();
};

window.toggleAccordion = function(headerElement) {
    const content = headerElement.nextElementSibling;
    const icon = headerElement.querySelector('i');
    
    if (content.classList.contains('open')) {
        content.classList.remove('open');
        content.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
    } else {
        content.classList.add('open');
        content.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
        const inputId = content.querySelector('input').id;
        document.getElementById(inputId).dispatchEvent(new Event('input'));
    }
};

// ==========================================
// 🔍 ระบบค้นหาวิชาตามหลักสูตร (แสดงผลครอบคลุมทุกเทอมแม้ยืนยันเวลาไม่ได้)
// ==========================================
function setupCourseSearch(inputId, resultsId) {
    const inputEl = document.getElementById(inputId);
    const resultsContainer = document.getElementById(resultsId);
    if(!inputEl || !resultsContainer) return;

    const renderList = (keyword) => {
        // 1. รวมวิชาจากตารางเทอมปัจจุบัน (allCourses) และแคตตาล็อกหลัก (masterCourses)
        let combinedCourses = [...allCourses];
        let seenCodes = new Set(allCourses.map(c => normalizeCourseCodeKey(c.COURSECODE)));
        
        masterCourses.forEach(c => {
            let code = normalizeCourseCodeKey(c.COURSECODE);
            if (!seenCodes.has(code)) {
                combinedCourses.push(c);
                seenCodes.add(code); // กันข้อมูลซ้ำ
            }
        });

        let matched = combinedCourses.filter(c => c.COURSECODE);
        
        if (keyword) {
            matched = matched.filter(c => {
                const code = (c.COURSECODE || '').toLowerCase();
                const name = (c.COURSENAME || '').toLowerCase();
                return code.includes(keyword) || name.includes(keyword);
            });
        }

        const displayMatched = matched.slice(0, 30);
        if (displayMatched.length === 0) {
            resultsContainer.innerHTML = '<div style="padding:15px; color:#999; text-align:center;">ไม่พบวิชาในระบบฐานข้อมูล</div>';
            return;
        }

        resultsContainer.innerHTML = displayMatched.map(course => {
            const dayStr = getDay(course);
            const startStr = getStart(course);
            const endStr = getEnd(course);
            const secStr = getSection(course);
            const credStr = getCredit(course);

            const uniqueId = `${course.COURSECODE}_${secStr}_${dayStr}_${startStr}`;
            const isChecked = selectedCourseIds.includes(uniqueId) ? 'checked' : '';
            
            // เช็คว่ามีเวลาเรียนจริงๆ ไหม
            const hasTime = (startStr && endStr && dayStr !== '-' && dayStr !== 'ไม่ระบุ' && dayStr !== 'รอประกาศ');

            let timeHtml = '';
            if (hasTime) {
                timeHtml = `<span style="color: #F05A28; font-weight: 500;"><i class="fa-regular fa-clock"></i> ${dayStr} ${startStr} - ${endStr}</span>`;
            } else {
                timeHtml = `<span style="color: #9ca3af; font-weight: 500;"><i class="fa-solid fa-circle-info"></i> รอประกาศเวลาเรียน (จัดเป็น Draft)</span>`;
            }

            return `
            <div class="course-list-item" style="padding: 12px 15px; border-bottom: 1px solid #f3f4f6; display: flex; align-items: flex-start; gap: 12px;">
                <input type="checkbox" class="course-checkbox" style="transform: scale(1.3); margin-top: 5px; cursor: pointer;"
                       value="${uniqueId}" data-code="${course.COURSECODE}"
                       data-name="${course.COURSENAME}" data-credit="${credStr}"
                       data-section="${secStr}" data-day="${hasTime ? dayStr : '-'}"
                       data-start="${hasTime ? startStr : '-'}" data-end="${hasTime ? endStr : '-'}"
                       onchange="window.handleDatabaseCourseSelection(this)" ${isChecked}>
                <div class="course-info" style="display: flex; flex-direction: column; gap: 6px;">
                    <strong style="font-size: 16px; color: #111827;">${window.formatCourseCodeDisplay(course.COURSECODE)} ${course.COURSENAME} (กลุ่ม ${secStr})</strong>
                    <div class="course-meta" style="font-size: 14px;">
                        ${timeHtml}
                        <span style="color: #6b7280; margin-left: 8px;">(${credStr} หน่วยกิต)</span>
                    </div>
                </div>
            </div>`;
        }).join('');
    };

    inputEl.oninput = function() { renderList(this.value.toLowerCase().trim()); };
    renderList(inputEl.value.toLowerCase().trim());
}

window.handleDatabaseCourseSelection = function(checkbox) {
    const uniqueId = checkbox.value; 
    const courseCode = checkbox.getAttribute('data-code');
    const courseName = checkbox.getAttribute('data-name');
    const section = checkbox.getAttribute('data-section');
    const dayName = checkbox.getAttribute('data-day');
    const startTimeStr = checkbox.getAttribute('data-start') || ''; 
    const endTimeStr = checkbox.getAttribute('data-end') || '';     
    
    let creditString = checkbox.getAttribute('data-credit') || '0';
    let creditNumber = parseInt(creditString.split(' ')[0]) || 0; 

    if (checkbox.checked) {
        let startHour = 0, endHour = 0;
        let noTimeFlag = true;

        // เช็คว่ามีเวลาเรียนส่งมาด้วยไหม
        if (startTimeStr && startTimeStr !== '-' && dayName !== '-' && dayName !== 'รอประกาศ') {
            startHour = parseInt(startTimeStr.split(':')[0]);
            endHour = parseInt(endTimeStr.split(':')[0]);
            let endMin = parseInt(endTimeStr.split(':')[1]);
            if (endMin > 0) endHour += 1;
            noTimeFlag = false;
        }

        // ตรวจสอบเวลาชน (เช็คเฉพาะวิชาที่มีเวลาเรียน)
        if (!noTimeFlag) {
            let isOverlap = false;
            let overlapCourseName = "";

            for (let existingCourse of selectedCoursesData) {
                if (existingCourse.day === dayName && !existingCourse.no_time) {
                    if (startHour < existingCourse.end && endHour > existingCourse.start) {
                        isOverlap = true; overlapCourseName = existingCourse.code; break; 
                    }
                }
            }

            if (isOverlap) {
                alert(`⚠️ ไม่สามารถเลือกวิชานี้ได้!\nเวลาเรียนทับซ้อนกับวิชา ${overlapCourseName}`);
                checkbox.checked = false;
                return; 
            }
        }

        selectedCourseIds.push(uniqueId);
        selectedCoursesData.push({ 
            id: uniqueId, 
            code: `${courseCode} (G.${section})`, 
            name: noTimeFlag ? `${courseName} (รอประกาศเวลา)` : courseName, 
            credits: creditNumber, 
            day: dayName, 
            start: startHour, 
            end: endHour, 
            no_time: noTimeFlag 
        });
        
    } else {
        selectedCourseIds = selectedCourseIds.filter(id => id !== uniqueId);
        selectedCoursesData = selectedCoursesData.filter(c => c.id !== uniqueId);
    }
    updateDatabaseTimetableAndCredits();
};

function updateDatabaseTimetableAndCredits() {
    let totalCredits = 0;
    const uniqueCourseCodes = new Set();
    selectedCoursesData.forEach(c => {
        const baseCode = c.code.split(' ')[0];
        if (!uniqueCourseCodes.has(baseCode)) {
            uniqueCourseCodes.add(baseCode);
            totalCredits += c.credits;
        }
    });
    
    const tcText = document.getElementById('total-credits-text');
    if (tcText) tcText.innerText = `รวม ${totalCredits} หน่วยกิต`;
    drawTimetableGrid(selectedCoursesData);
    updateSelectedCoursesCart();
}

// ==========================================
// 📅 4. วาดตารางเรียนหลัก
// ==========================================
function drawTimetableGrid(activeCourses = []) { 
    const grid = document.getElementById('timetable-grid');
    if (!grid) return;
    
    grid.className = ''; 
    grid.style.cssText = 'display: grid; background-color: #1f2937; border-radius: 8px; overflow: hidden; border: 1px solid #374151; box-shadow: 0 4px 6px rgba(0,0,0,0.1); position: relative; margin-bottom: 20px;';
    grid.innerHTML = ''; 
    
    let startHour = 8;
    let endHour = 18; 
    
    if (activeCourses && activeCourses.length > 0) {
        activeCourses.forEach(course => {
            if (course.no_time) return;
            if (course.start > 0 && course.start < startHour) startHour = course.start;
            if (course.end > 0 && course.end > endHour) endHour = course.end;
        });
    }

    const totalColumns = endHour - startHour;
    grid.style.gridTemplateColumns = `80px repeat(${totalColumns}, 1fr)`;

    const headerStyle = "background-color: #111827; color: white; padding: 12px 5px; text-align: center; font-size: 13px; font-weight: 600; border-bottom: 1px solid #374151; border-right: 1px solid #374151; display: flex; align-items: center; justify-content: center;";
    const dayStyle = "background-color: #111827; color: white; font-size: 13px; font-weight: 600; border-bottom: 1px solid #374151; border-right: 1px solid #374151; display: flex; align-items: center; justify-content: center;";
    const slotStyle = "background-color: #1f2937; border-bottom: 1px solid #374151; border-right: 1px solid #374151; min-height: 55px;";

    grid.insertAdjacentHTML('beforeend', `<div style="grid-row: 1; grid-column: 1; ${headerStyle}">Day/Time</div>`);
    let colIndex = 2;
    for (let i = startHour; i < endHour; i++) {
        grid.insertAdjacentHTML('beforeend', `<div style="grid-row: 1; grid-column: ${colIndex}; ${headerStyle}">${i}.00-${i+1}.00</div>`);
        colIndex++;
    }

    const days = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
    days.forEach((day, index) => {
        const row = index + 2; 
        grid.insertAdjacentHTML('beforeend', `<div style="grid-row: ${row}; grid-column: 1; ${dayStyle}">${day}</div>`);
        for (let c = 2; c <= colIndex - 1; c++) {
            grid.insertAdjacentHTML('beforeend', `<div style="grid-row: ${row}; grid-column: ${c}; ${slotStyle}"></div>`);
        }
    });

    if (activeCourses && activeCourses.length > 0) {
        activeCourses.forEach(course => {
            if (course.no_time) return;

            const dayIndex = days.indexOf(course.day) + 2; 
            const colStart = course.start - startHour + 2; 
            const duration = course.end - course.start;

            if (dayIndex >= 2 && colStart >= 2) {
                const baseCode = course.code.split(' ')[0];
                if (!courseColorMap[baseCode]) {
                    courseColorMap[baseCode] = classColors[Math.floor(Math.random() * classColors.length)];
                }

                const isCustom = String(course.id).startsWith('CUSTOM_') || String(course.id).startsWith('AI_') || String(course.id).startsWith('SHARED_');
                const bgColor = isCustom ? '#ef4444' : courseColorMap[baseCode]; 
                const displayCredit = isCustom ? 'กำหนดเอง' : `(${course.credits} หน่วย)`;

                const courseHTML = `
                    <div style="grid-row: ${dayIndex}; grid-column: ${colStart} / span ${duration}; background-color: ${bgColor}; color: #ffffff; cursor: pointer; border-radius: 6px; margin: 3px; padding: 4px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.2); z-index: 10; border: 1px solid rgba(255,255,255,0.1);" onclick="window.confirmRemoveCourse('${course.id}', '${window.formatCourseCodeDisplay(course.code)}')">
                        <div style="font-weight: 600; font-size: 18px; white-space: nowrap;">${window.formatCourseCodeDisplay(course.code)}</div>
                        <div style="font-size: 16px; opacity: 0.9; margin-top: 2px;">${course.start}.00-${course.end}.00</div>
                    </div>`;
                grid.insertAdjacentHTML('beforeend', courseHTML);
            }
        });
    }
}

// ==========================================
// 🎯 6. ระบบแนะนำวิชาอัตโนมัติ
// ==========================================
// ==========================================
// ⚡ ระบบจัดตารางเรียนแบบเร่งด่วน (อิงตามแผนการเรียน)
// ==========================================
window.handleAutoRecommend = async function() {
    const btn = document.getElementById('auto-plan-btn');
    
    if (!selectedMajor) { 
        return showErrorModal('ไม่พบข้อมูลสาขา', 'กรุณาเข้าสู่ระบบเพื่อยืนยันสาขาวิชาก่อนใช้งานฟังก์ชันนี้ครับ'); 
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังจัดตารางเร่งด่วน...';
    btn.disabled = true;

    try {
        const majorParam = encodeURIComponent(selectedMajor);
        // ดึงแผนการเรียนจากฐานข้อมูลตามสาขา ปี และเทอม ปัจจุบันที่ผู้ใช้เปิดอยู่
        const response = await fetch(`https://transfer-matcher-cable.ngrok-free.dev/api/recommend?major=${majorParam}&year=${currentYearLevel}&semester=${currentSemester}`);
        const result = await response.json();

        if (result.status === "success" && result.data && result.data.length > 0) {
            let addedCount = 0;
            let conflictCount = 0;
            let conflictDetails = [];

            // วนลูปวิชาที่อยู่ในแผนการเรียน
            for (let planCourse of result.data) {
                const cleanCode = (planCourse.COURSECODE || '').replace(/\s+/g, '').toUpperCase();
                if (!cleanCode) continue;

                // 1. เช็คว่ามีในตารางหรือยัง
                const isExist = selectedCoursesData.some(c => c.code.replace(/\s+/g, '').toUpperCase().includes(cleanCode));
                if (isExist) {
                    conflictCount++;
                    conflictDetails.push(`• <b>${cleanCode}</b> มีอยู่ในตารางแล้ว`);
                    continue;
                }

                // 2. ค้นหาข้อมูลเวลาเรียนจากวิชาที่เปิดสอนเทอมนี้ (allCourses)
                let foundCourse = allCourses.find(c => {
                    const cCode = (c.COURSECODE || '').replace(/\s+/g, '').toUpperCase();
                    const start = c.START_TIME || '';
                    return cCode === cleanCode && start !== '' && start !== 'TBD' && start !== '-';
                });

                if (!foundCourse) foundCourse = allCourses.find(c => (c.COURSECODE||'').replace(/\s+/g, '').toUpperCase() === cleanCode);
                if (!foundCourse) foundCourse = masterCourses.find(c => (c.COURSECODE||'').replace(/\s+/g, '').toUpperCase() === cleanCode);

                if (foundCourse) {
                    let normalizedCourse = normalizeCourseRow(foundCourse);
                    const secStr = normalizedCourse.SECTION || '1';
                    let dayStr = normalizedCourse.DAY_NAME || '-';
                    let startStr = normalizedCourse.START_TIME || '';
                    let endStr = normalizedCourse.END_TIME || '';

                    const uniqueId = `AUTO_${cleanCode}_${secStr}_${Date.now()}`;
                    let startHour = 0, endHour = 0;
                    let noTimeFlag = true;

                    // แปลงเวลาให้พร้อมลงตาราง
                    if (startStr && endStr && startStr !== 'TBD' && startStr !== '-' && dayStr !== '-' && dayStr !== 'รอประกาศ') {
                        startHour = parseInt(startStr.split(':')[0]);
                        endHour = parseInt(endStr.split(':')[0]);
                        let endMin = parseInt(endStr.split(':')[1]) || 0;
                        if (endMin > 0) endHour += 1;
                        noTimeFlag = false;
                    } else if (foundCourse.TIMESLOTFROM && foundCourse.TIMESLOTTO) {
                        startHour = Math.floor((foundCourse.TIMESLOTFROM - 1) * 5 / 60);
                        endHour = Math.floor((foundCourse.TIMESLOTTO - 1) * 5 / 60);
                        let endMin = ((foundCourse.TIMESLOTTO - 1) * 5) % 60;
                        if (endMin > 0) endHour += 1;
                        const dayMap = { 1:'อาทิตย์', 2:'จันทร์', 3:'อังคาร', 4:'พุธ', 5:'พฤหัสบดี', 6:'ศุกร์', 7:'เสาร์' };
                        if (foundCourse.WEEKDAY && dayMap[foundCourse.WEEKDAY]) dayStr = dayMap[foundCourse.WEEKDAY];
                        if (dayStr !== '-' && dayStr !== 'ไม่ระบุ' && dayStr !== 'รอประกาศ') noTimeFlag = false;
                    }

                    // 3. เช็คเวลาชนกัน
                    if (!noTimeFlag) {
                        let isOverlap = false;
                        let overlapName = "";
                        for (let ex of selectedCoursesData) {
                            if (ex.day === dayStr && !ex.no_time) {
                                if (startHour < ex.end && endHour > ex.start) {
                                    isOverlap = true; overlapName = ex.code; break;
                                }
                            }
                        }
                        if (isOverlap) {
                            conflictCount++;
                            conflictDetails.push(`• <b>${cleanCode}</b> เวลาเรียนทับซ้อนกับ <b>${overlapName}</b>`);
                            continue;
                        }
                    }

                    const formatCustomExam = (d, s, e) => {
                        if (!d || d.trim() === '-' || d.trim() === '') return "-";
                        const dateParts = d.split('/');
                        if(dateParts.length !== 3) return "-";
                        return `${dateParts[0]}/${dateParts[1]}/${dateParts[2]} เวลา ${s}-${e} น.`;
                    };

                    selectedCourseIds.push(uniqueId);
                    selectedCoursesData.push({
                        id: uniqueId, code: `${cleanCode} (G.${secStr})`,
                        name: normalizedCourse.COURSENAME || planCourse.COURSENAME || "รายวิชาตามแผน",
                        credits: parseInt(String(normalizedCourse.COURSEUNIT||'0').split(' ')[0]) || 0,
                        day: dayStr, start: startHour, end: endHour,
                        custom_mid_text: normalizedCourse.MID_DATE ? formatCustomExam(normalizedCourse.MID_DATE, normalizedCourse.MID_START, normalizedCourse.MID_END) : "-",
                        custom_fin_text: normalizedCourse.FIN_DATE ? formatCustomExam(normalizedCourse.FIN_DATE, normalizedCourse.FIN_START, normalizedCourse.FIN_END) : "-",
                        no_time: noTimeFlag
                    });
                    addedCount++;
                } else {
                    // 4. กรณีหาข้อมูลวิชาไม่เจอเลย ให้ยัดลงกล่อง Draft
                    const uniqueId = `AUTO_DRAFT_${cleanCode}_${Date.now()}`;
                    selectedCourseIds.push(uniqueId);
                    selectedCoursesData.push({
                        id: uniqueId, code: cleanCode,
                        name: planCourse.COURSENAME || "รายวิชาตามแผน (รอประกาศเวลา)",
                        credits: 0, day: '-', start: 0, end: 0,
                        custom_mid_text: "-", custom_fin_text: "-",
                        no_time: true
                    });
                    addedCount++;
                }
            } // ปิดลูปวิชาตามแผน

            // สรุปผลและแสดงแจ้งเตือน
            if(addedCount > 0) {
                updateDatabaseTimetableAndCredits();
                if(conflictCount > 0) {
                    let htmlMsg = `<div style="margin-bottom: 10px; color: #15803d;"><i class="fa-solid fa-circle-check"></i> จัดลงตารางสำเร็จ ${addedCount} วิชา</div>`;
                    htmlMsg += `<div style="color: #b91c1c; font-weight: 600; margin-bottom: 5px;"><i class="fa-solid fa-xmark"></i> ข้าม ${conflictCount} วิชา เนื่องจาก:</div>`;
                    htmlMsg += `<div style="font-size: 13px;">${conflictDetails.join('<br>')}</div>`;
                    showWarningModal(`จัดตารางด่วน ปี ${currentYearLevel} เทอม ${currentSemester} (ติดเงื่อนไข)`, htmlMsg);
                } else {
                    if(typeof showSuccessModal === 'function') {
                        showSuccessModal('จัดตารางด่วนสำเร็จ!', `ดึงรายวิชาตามแผนการเรียน ปี ${currentYearLevel} เทอม ${currentSemester} ลงตารางเรียบร้อยแล้วครับ!`);
                    }
                }
            } else {
                let htmlMsg = `<div style="color: #b91c1c; font-weight: 600; margin-bottom: 5px;"><i class="fa-solid fa-xmark"></i> สาเหตุที่ไม่สามารถเพิ่มได้:</div>`;
                htmlMsg += `<div style="font-size: 13px;">${conflictDetails.join('<br>')}</div>`;
                showWarningModal('ไม่สามารถจัดตารางให้ได้', htmlMsg);
            }

        } else {
            showErrorModal('ไม่พบแผนการเรียน', `ระบบไม่มีข้อมูลวิชาในแผนการเรียนของสาขาคุณสำหรับ ปี ${currentYearLevel} เทอม ${currentSemester} ครับ`);
        }

    } catch (error) {
        console.error("Auto Plan Error:", error);
        showErrorModal('เกิดข้อผิดพลาด', 'ไม่สามารถเชื่อมต่อฐานข้อมูลเพื่อดึงแผนการเรียนได้ครับ');
    } finally {
        // คืนค่าปุ่มกลับเหมือนเดิม
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

function aiAutoAddCourse(courseCode, pillElement) {
    const cleanCode = normalizeCourseCodeKey(courseCode);
    const foundSchedules = allCourses.filter(c => normalizeCourseCodeKey(c.COURSECODE) === cleanCode);

    const validSchedules = foundSchedules.filter(c => {
        const d = getDay(c);
        return d !== '-' && d !== 'ไม่ระบุ' && getStart(c) && getEnd(c);
    });
    
    if (validSchedules.length > 0) {
        const targetSection = getSection(validSchedules[0]);
        const schedulesToProcess = validSchedules.filter(c => getSection(c) == targetSection);
        
        let isOverlap = false;
        let overlapCourseName = "";
        for (let schedule of schedulesToProcess) {
            let startHour = parseInt(getStart(schedule).split(':')[0]);
            let endHour = parseInt(getEnd(schedule).split(':')[0]);
            let endMin = parseInt(getEnd(schedule).split(':')[1]);
            if (endMin > 0) endHour += 1;

            for (let existingCourse of selectedCoursesData) {
                if (existingCourse.day === getDay(schedule) && !existingCourse.no_time) {
                    if (startHour < existingCourse.end && endHour > existingCourse.start) {
                        isOverlap = true; overlapCourseName = existingCourse.code; break;
                    }
                }
            }
            if (isOverlap) break;
        }

        if (isOverlap) return alert(`⚠ ไม่สามารถเพิ่มวิชานี้ได้! เวลาเรียนทับซ้อนกับวิชา ${overlapCourseName}`);

        schedulesToProcess.forEach(schedule => {
            let startHour = parseInt(getStart(schedule).split(':')[0]);
            let endHour = parseInt(getEnd(schedule).split(':')[0]);
            let endMin = parseInt(getEnd(schedule).split(':')[1]);
            if (endMin > 0) endHour += 1;

            const sDay = getDay(schedule);
            const sectionStr = getSection(schedule);
            const uniqueId = `${schedule.COURSECODE}_${sectionStr}_${sDay}_${startHour}`;

            if (!selectedCourseIds.includes(uniqueId)) {
                selectedCourseIds.push(uniqueId);
                selectedCoursesData.push({
                    id: uniqueId, code: `${schedule.COURSECODE} (G.${sectionStr})`, name: schedule.COURSENAME || 'รายวิชา', credits: parseInt(getCredit(schedule).toString().split(' ')[0]) || 0, day: sDay, start: startHour, end: endHour, no_time: false
                });
            }
        });
        
        updateDatabaseTimetableAndCredits();
        
        if (pillElement) {
            pillElement.style.opacity = '0.5'; pillElement.style.pointerEvents = 'none';
            pillElement.style.background = '#f3f4f6'; pillElement.style.borderColor = '#d1d5db';
            pillElement.innerHTML = `<i class="fa-solid fa-check-circle" style="color: #9ca3af; margin-right: 6px; font-size: 15px;"></i> <strong>${courseCode}</strong> &nbsp;(เพิ่มแล้ว)`;
        }
        showSuccessModal('เพิ่มวิชาสำเร็จ!', `จัดวิชา ${courseCode} ลงตารางเรียบร้อยแล้วครับ`);
    } else {
        alert(`⚠️ วิชานี้ยังไม่เปิดสอนหรือยังไม่มีตารางเรียนในระบบเทอมนี้\n\nหากต้องการวางแผนล่วงหน้า กรุณาใช้ปุ่ม "+ กำหนดรายวิชาเอง" ครับ`);
    }
}

// ==========================================
// 🤖 ระบบ AI Chatbot วางแผนการเรียน (อัปเดตระบบความจำ + ระบบขยายหน้าจอ)
// ==========================================

// สร้างตัวแปรเก็บประวัติการคุย
if (!window.chatHistoryContext) window.chatHistoryContext = [];

window.sendAIMessage = async function() {
    const inputEl = document.getElementById('ai-msg-input');
    const chatHistory = document.getElementById('ai-chat-history');
    let userText = inputEl.value.trim();

    if (!userText) return;

    // 🔥 เพิ่มระบบดักจับคำและแปลงเสียงอ่านให้ตรงกับ Database
    userText = userText
        // 1. แปลงคำอ่านภาษาไทยให้เป็นรหัสวิชาอังกฤษ
        .replace(/ดีจีที/g, "DGT")
        .replace(/ไอเอสที/g, "IST")
        .replace(/ไอเอ็นที/g, "INT")
        .replace(/แคลคูลัส|แคลคูลัด|แคล/g, "Calculus")
        .replace(/ฟิสิกส์|ฟิสิก/g, "Physics")
        .replace(/เคมี/g, "Chemistry")
        // 2. แปลงคำอ่านตัวเลขให้เป็นตัวเลขจริงๆ (เวลาพูดรหัสวิชา)
        .replace(/ศูนย์/g, "0")
        .replace(/หนึ่ง/g, "1")
        .replace(/สอง/g, "2")
        .replace(/สาม/g, "3")
        .replace(/สี่/g, "4")
        .replace(/ห้า/g, "5")
        .replace(/หก/g, "6")
        .replace(/เจ็ด/g, "7")
        .replace(/แปด/g, "8")
        .replace(/เก้า/g, "9")
        // 3. ลบช่องว่างที่อาจเกิดขึ้นระหว่างตัวเลขและตัวอักษร
        .replace(/DGT\s+/gi, "DGT")
        .replace(/IST\s+/gi, "IST");

    
    // ... โค้ดต่อจากนี้เหมือนเดิมเป๊ะๆ ครับ

    let actualYear = window.currentYearLevel;
    const profileYearEl = document.getElementById('profile-year-level');
    if (profileYearEl && profileYearEl.value) {
        actualYear = parseInt(profileYearEl.value) || window.currentYearLevel;
    }

    let actualMajor = window.selectedMajor;
    const profileMajorEl = document.getElementById('profile-major');
    if (profileMajorEl && profileMajorEl.value) {
        actualMajor = profileMajorEl.value;
    }

    window.chatHistoryContext.push({ role: "user", content: userText });

    inputEl.value = '';
    chatHistory.insertAdjacentHTML('beforeend', `
        <div style="align-self: flex-end; background: #F05A28; color: white; padding: 10px 15px; border-radius: 15px 15px 0 15px; font-size: 13px; max-width: 85%;">
            ${userText}
        </div>
    `);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    const loadingId = 'loading-' + Date.now();
    chatHistory.insertAdjacentHTML('beforeend', `
        <div id="${loadingId}" style="align-self: flex-start; color: #9ca3af; font-size: 12px; padding: 5px;">
            <i class="fa-solid fa-spinner fa-spin"></i> รุ่นพี่ AI กำลังคิด...
        </div>
    `);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    try {
        const response = await fetch('https://transfer-matcher-cable.ngrok-free.dev/api/aichat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: userText,
                major: actualMajor,
                year: actualYear,
                semester: window.currentSemester,
                history: window.chatHistoryContext.slice(-6)
            })
        });

        const result = await response.json();
        document.getElementById(loadingId).remove(); 

        if (result.status === 'success') {
            let aiText = result.reply;
            window.chatHistoryContext.push({ role: "assistant", content: aiText });

            let actionButtonHTML = '';
            // 🔥 อัปเกรด Regex ให้จับโค้ดได้แม้ AI จะเผลอขึ้นบรรทัดใหม่
            const courseMatch = aiText.match(/\[COURSES:\s*([\s\S]+?)\]/);
            if (courseMatch) {
                // ตัดขึ้นบรรทัดใหม่ออกให้หมดก่อนส่งไปสร้างปุ่ม
                const courseCodesRaw = courseMatch[1].replace(/\n/g, '').trim(); 
                aiText = aiText.replace(/\[COURSES:\s*([\s\S]+?)\]/g, ''); 

                actionButtonHTML = `
                    <button onclick="window.applyAICoursesList('${courseCodesRaw}')" style="margin-top: 15px; width: 100%; background: #10b981; color: white; border: none; padding: 10px; border-radius: 8px; cursor: pointer; font-family: 'Prompt'; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; transition: 0.2s;">
                        <i class="fa-solid fa-calendar-plus"></i> เพิ่มวิชาเหล่านี้ลงตาราง
                    </button>
                `;
            }

            let formattedText = aiText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

            chatHistory.insertAdjacentHTML('beforeend', `
                <div style="align-self: flex-start; background: #fff; border: 1px solid #e5e7eb; color: #333; padding: 15px; border-radius: 15px 15px 15px 0; font-size: 13px; max-width: 95%; box-shadow: 0 2px 5px rgba(0,0,0,0.02);">
                    <div style="font-weight: 600; margin-bottom: 10px; color: #4b5563;">
                        <i class="fa-solid fa-robot"></i> SUT AI Advisor:
                    </div>
                    <div style="line-height: 1.6;">${formattedText}</div>
                    ${actionButtonHTML}
                </div>
            `);
        } else {
            chatHistory.insertAdjacentHTML('beforeend', `<div style="color: red; font-size: 12px;">เกิดข้อผิดพลาดจากเซิร์ฟเวอร์</div>`);
        }
    } catch (error) {
        if(document.getElementById(loadingId)) document.getElementById(loadingId).remove();
        chatHistory.insertAdjacentHTML('beforeend', `<div style="color: red; font-size: 12px;">เชื่อมต่อระบบ AI ไม่สำเร็จ</div>`);
    }
    chatHistory.scrollTop = chatHistory.scrollHeight;
};
// ==========================================
// 🚀 ฟังก์ชันประมวลผลวิชาจาก AI (ดึงเวลาจริงจาก Database 100% + แก้ AI หลอน)
// ==========================================
window.applyAICoursesList = async function(rawCodesStr) {
    const coursesArray = rawCodesStr.split(',').map(item => item.trim());
    let addedCount = 0;
    let conflictCount = 0;
    let conflictDetails = []; 

    const chatHistory = document.getElementById('ai-chat-history');
    const loadingId = 'ai-loading-' + Date.now();
    if (chatHistory) {
        chatHistory.insertAdjacentHTML('beforeend', `<div id="${loadingId}" style="color: #10b981; font-size: 12px; margin-top: 5px;"><i class="fa-solid fa-spinner fa-spin"></i> กำลังตรวจสอบข้อมูลกับฐานข้อมูล...</div>`);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    for (const courseData of coursesArray) {
        if(!courseData) continue;
        
        try {
            const parts = courseData.split('|');
            const courseCode = (parts[0] || '').replace(/["'\s]/g, '').toUpperCase();
            let secStr = parts[1] || '1';
            
            // รับค่าจาก AI (เผื่อไว้)
            let dayStr = parts[2] || '-';
            let startStr = parts[3] || '-';
            let endStr = parts[4] || '-';

            if(!courseCode) continue;

            let courseName = "รายวิชา";
            let courseCredit = 0;
            
            // 🎯 1. ค้นหากลุ่มที่ AI แนะนำมา ว่ามีอยู่จริงและมีเวลาเรียนหรือไม่
            let foundCourse = allCourses.find(c => 
                (c.COURSECODE||'').replace(/\s+/g, '').toUpperCase() === courseCode && 
                String(c.SECTION || '1') === String(secStr) &&
                ((c.START_TIME && c.START_TIME !== '-') || c.TIMESLOTFROM)
            );

            // 🎯 2. ถ้าไม่เจอ (AI เดากลุ่มผิด หรือกลุ่มนั้นไม่มีเวลา) ให้หา "กลุ่มไหนก็ได้" ของวิชานี้ ที่มีเวลาเรียนในเทอมนี้!
            if (!foundCourse) {
                foundCourse = allCourses.find(c => 
                    (c.COURSECODE||'').replace(/\s+/g, '').toUpperCase() === courseCode &&
                    ((c.START_TIME && c.START_TIME !== '-') || c.TIMESLOTFROM)
                );
            }

            // 🎯 3. ถ้าเทอมนี้ไม่มีเวลาเรียนเปิดสอนเลยจริงๆ ค่อยดึงแค่ชื่อกับหน่วยกิตมา
            if (!foundCourse) {
                foundCourse = allCourses.find(c => (c.COURSECODE||'').replace(/\s+/g, '').toUpperCase() === courseCode) ||
                              masterCourses.find(c => (c.COURSECODE||'').replace(/\s+/g, '').toUpperCase() === courseCode);
            }

            // 🌟 สำคัญที่สุด: เขียนทับข้อมูลที่ AI เดามา ด้วยข้อมูลจริงจาก Database ของมหาลัย
            if (foundCourse) {
                courseName = foundCourse.COURSENAME || courseName;
                courseCredit = parseInt(String(foundCourse.COURSEUNIT||'0').split(' ')[0]) || 0;
                secStr = foundCourse.SECTION || secStr; // เปลี่ยนกลุ่มให้ถูกต้องตามความเป็นจริง
                
                if (foundCourse.DAY_NAME && foundCourse.DAY_NAME !== '-') dayStr = foundCourse.DAY_NAME;
                if (foundCourse.START_TIME && foundCourse.START_TIME !== '-') startStr = foundCourse.START_TIME;
                if (foundCourse.END_TIME && foundCourse.END_TIME !== '-') endStr = foundCourse.END_TIME;

                // กรณีระบบ Database ใช้ TIMESLOT แทน START_TIME
                if ((!startStr || startStr === '-') && foundCourse.TIMESLOTFROM) {
                    let sH = Math.floor((foundCourse.TIMESLOTFROM - 1) * 5 / 60);
                    let eH = Math.floor((foundCourse.TIMESLOTTO - 1) * 5 / 60);
                    startStr = `${sH}:00`;
                    endStr = `${eH}:00`;
                    const dayMap = { 1:'อาทิตย์', 2:'จันทร์', 3:'อังคาร', 4:'พุธ', 5:'พฤหัสบดี', 6:'ศุกร์', 7:'เสาร์' };
                    if (foundCourse.WEEKDAY && dayMap[foundCourse.WEEKDAY]) dayStr = dayMap[foundCourse.WEEKDAY];
                }
            }

            const uniqueId = `AI_${courseCode}_${secStr}_${Date.now()}`;
            const isExist = selectedCoursesData.some(c => c.code.replace(/\s+/g, '').toUpperCase().includes(courseCode));
            
            if(!isExist) {
                let startHour = 0, endHour = 0;
                let noTimeFlag = true;

                if (startStr && startStr !== '-' && startStr !== 'TBD' && endStr && endStr !== '-' && endStr !== 'TBD' && dayStr && dayStr !== '-' && dayStr !== 'รอประกาศ' && dayStr !== 'ไม่ระบุ') {
                    startHour = parseInt(startStr.split(':')[0]);
                    endHour = parseInt(endStr.split(':')[0]);
                    let endMin = parseInt(endStr.split(':')[1]) || 0;
                    if (endMin > 0) endHour += 1;
                    noTimeFlag = false; 
                }

                // ตรวจสอบเวลาชน
                if (!noTimeFlag) {
                    let isOverlap = false;
                    let overlapCourseName = ""; 
                    for (let existingCourse of selectedCoursesData) {
                        if (existingCourse.day === dayStr && !existingCourse.no_time) {
                            if (startHour < existingCourse.end && endHour > existingCourse.start) {
                                isOverlap = true; 
                                overlapCourseName = existingCourse.code;
                                break;
                            }
                        }
                    }
                    if (isOverlap) { 
                        conflictCount++; 
                        conflictDetails.push(`• <b>${courseCode}</b> ทับซ้อนกับ <b>${overlapCourseName}</b>`);
                        continue; 
                    }
                }

                selectedCourseIds.push(uniqueId);
                selectedCoursesData.push({
                    id: uniqueId, code: `${courseCode} (G.${secStr})`, 
                    name: noTimeFlag ? `${courseName} (รอประกาศเวลา)` : courseName, 
                    credits: courseCredit, day: dayStr, start: startHour, end: endHour,
                    custom_mid_text: "-", custom_fin_text: "-", no_time: noTimeFlag
                });
                addedCount++;
            } else {
                conflictCount++;
                conflictDetails.push(`• <b>${courseCode}</b> มีอยู่ในตารางแล้ว`);
            }
        } catch (err) { console.error('Error parsing AI course data:', err); }
    }

    const loadingIndicator = document.getElementById(loadingId);
    if (loadingIndicator) loadingIndicator.remove();

    if(addedCount > 0) {
        updateDatabaseTimetableAndCredits();
        if(conflictCount > 0) {
            let htmlMsg = `<div style="margin-bottom: 10px; color: #15803d;"><i class="fa-solid fa-circle-check"></i> เพิ่มลงตารางสำเร็จ ${addedCount} วิชา</div>`;
            htmlMsg += `<div style="color: #b91c1c; font-weight: 600; margin-bottom: 5px;"><i class="fa-solid fa-xmark"></i> ไม่สามารถเพิ่ม ${conflictCount} วิชาได้ เนื่องจาก:</div>`;
            htmlMsg += `<div style="font-size: 13px;">${conflictDetails.join('<br>')}</div>`;
            showWarningModal('เพิ่มวิชาได้บางส่วน', htmlMsg);
        } else {
            if(typeof showSuccessModal === 'function') {
                showSuccessModal('สำเร็จ!', `เพิ่ม ${addedCount} รายวิชาลงตารางเรียนเรียบร้อยแล้วครับ!`);
            } else {
                alert(`ดึง ${addedCount} รายวิชาลงตารางเรียนเรียบร้อยแล้วครับ!`);
            }
        }
    } else {
        let htmlMsg = `<div style="color: #b91c1c; font-weight: 600; margin-bottom: 5px;"><i class="fa-solid fa-xmark"></i> สาเหตุที่ไม่สามารถเพิ่มได้:</div>`;
        htmlMsg += `<div style="font-size: 13px;">${conflictDetails.join('<br>')}</div>`;
        showWarningModal('ไม่สามารถเพิ่มวิชาได้', htmlMsg);
    }
};
// ==========================================
// 🛒 8. ตะกร้าวิชาที่เลือก 
// ==========================================
function updateSelectedCoursesCart() {
    const cartContainer = document.getElementById('selected-courses-list');
    if (!cartContainer) return;

    cartContainer.innerHTML = ''; 
    if (selectedCourseIds.length === 0) {
        cartContainer.innerHTML = '<div style="text-align: center; color: #adb5bd; font-size: 0.9em; padding: 20px;">ยังไม่มีวิชาที่เลือก</div>';
        return;
    }

    const pastelColors = ['#fca5a5', '#c4b5fd', '#f9a8d4', '#fef08a', '#86efac', '#93c5fd'];
    const uniqueCourses = {};
    
    selectedCoursesData.forEach(c => {
        const pureCode = c.code.split(' (G.')[0]; 
        const sectionMatch = c.code.match(/G\.(\d+)/);
        const section = sectionMatch ? sectionMatch[1] : '1';
        
        if (!uniqueCourses[pureCode]) {
            uniqueCourses[pureCode] = { 
                ids: [c.id], code: pureCode, name: c.name, credits: c.credits, section: section, 
                times: c.no_time ? [] : [`${c.day} ${c.start}.00-${c.end}.00`],
                custom_mid_text: c.custom_mid_text, custom_fin_text: c.custom_fin_text  
            };
        } else {
            uniqueCourses[pureCode].ids.push(c.id);
            if (!c.no_time) uniqueCourses[pureCode].times.push(`${c.day} ${c.start}.00-${c.end}.00`);
        }
    });

    let colorIndex = 0;
    Object.values(uniqueCourses).forEach(course => {
        const bgColor = pastelColors[colorIndex % pastelColors.length];
        colorIndex++;

        let foundCourse = allCourses.find(c => normalizeCourseCodeKey(c.COURSECODE) === normalizeCourseCodeKey(course.code) && String(getSection(c)) === String(course.section)) || {};
        
        const formatExam = (dateStr, startStr, endStr) => {
            if (!dateStr || dateStr.trim() === '' || dateStr.trim() === '-') return "-";
            let formattedDate = dateStr;
            let timeText = (startStr && endStr) ? ` เวลา ${startStr}-${endStr} น.` : "";
            if (formattedDate.includes('/')) {
                let parts = formattedDate.split('/');
                if (parts.length === 3 && parseInt(parts[2]) < 2500) {
                    parts[2] = parseInt(parts[2]) + 543;
                    formattedDate = parts.join('/'); 
                }
            }
            return formattedDate + timeText;
        };

        const midText = course.custom_mid_text ? course.custom_mid_text : formatExam(getMidDate(foundCourse), getMidStart(foundCourse), getMidEnd(foundCourse));
        const finText = course.custom_fin_text ? course.custom_fin_text : formatExam(getFinDate(foundCourse), getFinStart(foundCourse), getFinEnd(foundCourse));
        
        const nameEN = foundCourse.COURSENAME_ENG || course.name; 
        const timeString = course.times.length > 0 ? course.times.join(', ') : 'ไม่มีข้อมูลเวลาเรียน (กำหนดเอง)';
        const idsString = course.ids.join(',');

        const cardHTML = `
            <div class="selected-course-card">
                <div class="course-card-left" style="background-color: ${bgColor};">
                    <span>${window.formatCourseCodeDisplay(course.code)}</span>
                    <span style="font-size: 12px; font-weight: normal; margin-top: 4px;">กลุ่ม ${course.section}</span>
                </div>
                <div class="course-card-right">
                    <div class="course-header-row">
                        <div class="course-name-title">${nameEN}</div>
                        <div class="credit-pill">${course.credits} หน่วยกิต</div>
                    </div>
                    <div class="course-details-text">${course.name}</div>
                    <div class="course-details-text"><i class="fa-regular fa-clock"></i> เวลาเรียน: ${timeString}</div>
                    <div class="exam-date-text" style="display: flex; flex-direction: column; gap: 4px; margin-top: 6px;">
                        <div style="color: #F39C12;"><i class="fa-solid fa-file-pen"></i> สอบกลางภาค: ${midText}</div>
                        <div style="color: #ef4444;"><i class="fa-regular fa-calendar-check"></i> สอบปลายภาค: ${finText}</div>
                    </div>
                </div>
                <button class="delete-btn-modern" onclick="window.removeCourseFromList('${idsString}')"><i class="fa-solid fa-trash"></i> ลบ</button>
            </div>`;
        cartContainer.insertAdjacentHTML('beforeend', cardHTML);
    });
}

window.removeCourseFromList = function(idsString) {
    const idsToRemove = idsString.split(',');
    selectedCourseIds = selectedCourseIds.filter(id => !idsToRemove.includes(id));
    selectedCoursesData = selectedCoursesData.filter(c => !idsToRemove.includes(c.id));
    idsToRemove.forEach(id => {
        const checkbox = document.querySelector(`.course-checkbox[value="${id}"]`);
        if (checkbox) checkbox.checked = false;
    });
    const currentKey = `${currentYearLevel}_${currentSemester}`;
    if (scheduleCache[currentKey]) {
        scheduleCache[currentKey].ids = [...selectedCourseIds];
        scheduleCache[currentKey].data = [...selectedCoursesData];
    }
    updateDatabaseTimetableAndCredits();
};

// ==========================================
// 💾 ฟังก์ชันบันทึกและโหลดตารางเรียน
// ==========================================
async function saveSchedule() {
    const studentId = localStorage.getItem('sut_student_id');
    if (!studentId) return;
    
    const btn = document.getElementById('save-schedule-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';
    btn.disabled = true;

    try {
        const safeData = JSON.parse(JSON.stringify(selectedCoursesData));
        const scheduleData = { 
            student_id: studentId, 
            year_level: currentYearLevel, 
            semester: currentSemester, 
            course_ids: safeData 
        };
        
        await supabaseClient.from('user_schedules')
            .delete()
            .match({ student_id: studentId, year_level: currentYearLevel, semester: currentSemester });
            
        const { error } = await supabaseClient.from('user_schedules').insert([scheduleData]);
        if (error) throw error;

        const currentKey = `${currentYearLevel}_${currentSemester}`;
        scheduleCache[currentKey] = { 
            ids: JSON.parse(JSON.stringify(selectedCourseIds)), 
            data: JSON.parse(JSON.stringify(selectedCoursesData)) 
        };

        showSuccessModal('บันทึกตารางเรียนสำเร็จ!', 'ระบบจัดเก็บตารางเรียนของคุณลงฐานข้อมูลเรียบร้อยแล้ว');
    } catch (error) { 
        console.error("Save Error:", error); 
        alert('เกิดข้อผิดพลาดในการบันทึก: ' + error.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function loadSchedule() {
    const studentId = localStorage.getItem('sut_student_id');
    if (!studentId) return;

    const currentKey = `${currentYearLevel}_${currentSemester}`;

    if (scheduleCache[currentKey]) {
        selectedCourseIds = JSON.parse(JSON.stringify(scheduleCache[currentKey].ids));
        selectedCoursesData = JSON.parse(JSON.stringify(scheduleCache[currentKey].data));
        updateUI();
        return;
    }

    selectedCourseIds = [];
    selectedCoursesData = [];
    updateUI();

    try {
        const { data, error } = await supabaseClient
            .from('user_schedules')
            .select('course_ids')
            .eq('student_id', studentId)
            .eq('year_level', currentYearLevel)
            .eq('semester', currentSemester)
            .maybeSingle();

        if (error) throw error;

        if (data && data.course_ids && data.course_ids.length > 0) {
            if (typeof data.course_ids[0] === 'object') {
                selectedCoursesData = JSON.parse(JSON.stringify(data.course_ids));
                selectedCourseIds = selectedCoursesData.map(c => c.id);
            }
            
            scheduleCache[currentKey] = { 
                ids: JSON.parse(JSON.stringify(selectedCourseIds)), 
                data: JSON.parse(JSON.stringify(selectedCoursesData)) 
            };
        }
        
        updateUI();
    } catch (error) {
        console.error("Load Error:", error);
        updateUI();
    }

    function updateUI() {
        document.querySelectorAll('.course-checkbox').forEach(cb => { 
            cb.checked = selectedCourseIds.includes(cb.value); 
        });
        updateDatabaseTimetableAndCredits();
    }
}

// ==========================================
// 🔍 ระบบ Autofill ค้นหาวิชาสำหรับหน้า "กำหนดรายวิชาเอง"
// ==========================================
window.setupCustomCourseAutocomplete = function() {
    const searchInput = document.getElementById('custom-course-search');
    const dropdown = document.getElementById('custom-course-dropdown');

    if (!searchInput || !dropdown) return;

    searchInput.addEventListener('input', function(e) {
        const keyword = e.target.value.toLowerCase().trim();
        
        if (!keyword) {
            dropdown.style.display = 'none';
            return;
        }

        let combinedCourses = [];
        let seenCodes = new Set();
        
        [...allCourses, ...masterCourses].forEach(c => {
            if (c.COURSECODE && !seenCodes.has(c.COURSECODE)) {
                combinedCourses.push(c);
                seenCodes.add(c.COURSECODE);
            }
        });

        const matched = combinedCourses.filter(c => {
            const code = (c.COURSECODE || '').toLowerCase();
            const name = (c.COURSENAME || '').toLowerCase();
            return code.includes(keyword) || name.includes(keyword);
        }).slice(0, 15);

        if (matched.length === 0) {
            dropdown.innerHTML = '<div style="padding: 15px; text-align: center; color: #9ca3af; font-size: 13px;">ไม่พบรายวิชานี้ในระบบ...<br>กรุณาพิมพ์ข้อมูลฝั่งขวาด้วยตัวเอง</div>';
            dropdown.style.display = 'block';
            return;
        }

        dropdown.innerHTML = matched.map(c => `
            <div class="autocomplete-item" data-code="${c.COURSECODE}" data-sec="${c.SECTION || '1'}" style="padding: 12px 15px; cursor: pointer; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: left; transition: 0.2s;">
                <strong style="color: #111; display: block; margin-bottom: 4px;">${window.formatCourseCodeDisplay(c.COURSECODE)} ${c.SECTION && c.SECTION !== '1' ? `(กลุ่ม ${c.SECTION})` : ''}</strong>
                <span style="font-size: 12px; color: #6b7280;">${c.COURSENAME}</span>
            </div>
        `).join('');

        dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', function() {
                const code = this.getAttribute('data-code');
                const sec = this.getAttribute('data-sec');
                window.selectCustomCourse(code, sec);
            });
            item.addEventListener('mouseover', function() { this.style.backgroundColor='#fff1f2'; this.style.color='#F05A28'; });
            item.addEventListener('mouseout', function() { this.style.backgroundColor='transparent'; this.style.color='#374151'; });
        });

        dropdown.style.display = 'block';
    });

    document.addEventListener('click', function(e) {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
};

window.selectCustomCourse = function(courseCode, section) {
    let course = allCourses.find(c => c.COURSECODE === courseCode && String(c.SECTION || '1') === String(section));
    if (!course) course = masterCourses.find(c => c.COURSECODE === courseCode);
    if (!course) return;

    document.getElementById('custom-code').value = course.COURSECODE || '';
    document.getElementById('custom-name').value = course.COURSENAME || '';

    const dayMapReverse = { 'จันทร์': 'MON', 'อังคาร': 'TUE', 'พุธ': 'WED', 'พฤหัสบดี': 'THU', 'ศุกร์': 'FRI', 'เสาร์': 'SAT', 'อาทิตย์': 'SUN' };
    if (course.DAY_NAME && dayMapReverse[course.DAY_NAME]) {
        document.getElementById('custom-day').value = dayMapReverse[course.DAY_NAME];
    }
    if (course.START_TIME) document.getElementById('custom-start').value = course.START_TIME;
    if (course.END_TIME) document.getElementById('custom-end').value = course.END_TIME;

    const formatDateForInput = (dateStr) => {
        if (!dateStr || dateStr === '-' || dateStr.trim() === '') return '';
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            let d = parts[0].padStart(2, '0'), m = parts[1].padStart(2, '0'), y = parseInt(parts[2]);
            if (y > 2500) y -= 543; 
            return `${y}-${m}-${d}`;
        }
        return '';
    };

    document.getElementById('custom-mid-date').value = formatDateForInput(course.MID_DATE);
    document.getElementById('custom-mid-start').value = course.MID_START || '';
    document.getElementById('custom-mid-end').value = course.MID_END || '';

    document.getElementById('custom-fin-date').value = formatDateForInput(course.FIN_DATE);
    document.getElementById('custom-fin-start').value = course.FIN_START || '';
    document.getElementById('custom-fin-end').value = course.FIN_END || '';

    document.getElementById('custom-course-search').value = '';
    document.getElementById('custom-course-dropdown').style.display = 'none';

    const inputsToFlash = ['custom-code', 'custom-name', 'custom-day', 'custom-start', 'custom-end', 'custom-mid-date', 'custom-fin-date'];
    inputsToFlash.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.style.transition = 'border-color 0.3s';
            el.style.borderColor = '#10b981';
            setTimeout(() => el.style.borderColor = '#d1d5db', 800);
        }
    });
};

window.addCustomCourseToTable = function() {
    const code = document.getElementById('custom-code').value.trim();
    const name = document.getElementById('custom-name').value.trim();
    const dayVal = document.getElementById('custom-day').value;
    const start = document.getElementById('custom-start').value;
    const end = document.getElementById('custom-end').value;

    const midDate = document.getElementById('custom-mid-date').value;
    const midStart = document.getElementById('custom-mid-start').value;
    const midEnd = document.getElementById('custom-mid-end').value;
    
    const finDate = document.getElementById('custom-fin-date').value;
    const finStart = document.getElementById('custom-fin-start').value;
    const finEnd = document.getElementById('custom-fin-end').value;

    if(!code || !name) return alert('⚠️ กรุณากรอกรหัสวิชาและชื่อวิชาให้ครบถ้วน');

    if(!start || !end || start.trim() === '' || end.trim() === '') {
        const uniqueId = `CUSTOM_${Date.now()}`;
        selectedCourseIds.push(uniqueId);
        
        const formatCustomExam = (d, s, e) => {
            if (!d) return "-";
            const dateParts = d.split('-'); 
            if(dateParts.length !== 3) return "-";
            const yearTH = parseInt(dateParts[0]) + 543;
            let formattedDate = `${dateParts[2]}/${dateParts[1]}/${yearTH}`;
            let timeText = (s && e) ? ` เวลา ${s}-${e} น.` : "";
            return formattedDate + timeText;
        };

        selectedCoursesData.push({
            id: uniqueId, code: code, name: name, credits: 0, day: '-', start: 0, end: 0,
            custom_mid_text: formatCustomExam(midDate, midStart, midEnd),
            custom_fin_text: formatCustomExam(finDate, finStart, finEnd),
            no_time: true
        });

        updateDatabaseTimetableAndCredits();
        document.getElementById('modal-custom-course').style.display = 'none';
        
        document.getElementById('custom-code').value = ''; document.getElementById('custom-name').value = '';
        document.getElementById('custom-course-search').value = ''; document.getElementById('custom-mid-date').value = ''; 
        document.getElementById('custom-mid-start').value = ''; document.getElementById('custom-mid-end').value = '';
        document.getElementById('custom-fin-date').value = ''; document.getElementById('custom-fin-start').value = ''; 
        document.getElementById('custom-fin-end').value = '';

        return showSuccessModal('เพิ่มลงตะกร้าแล้ว!', `เพิ่มวิชา ${code} สำเร็จ\n(จัดเก็บลงตะกร้าเพราะไม่ได้ระบุเวลาเรียน)`);
    }

    const dayMap = { 'MON': 'จันทร์', 'TUE': 'อังคาร', 'WED': 'พุธ', 'THU': 'พฤหัสบดี', 'FRI': 'ศุกร์', 'SAT': 'เสาร์', 'SUN': 'อาทิตย์' };
    const thaiDay = dayMap[dayVal];

    let startHour = parseInt(start.split(':')[0]);
    let endHour = parseInt(end.split(':')[0]);
    let endMin = parseInt(end.split(':')[1]);
    if (endMin > 0) endHour += 1; 

    let isOverlap = false;
    let overlapCourseName = "";
    for (let existingCourse of selectedCoursesData) {
        if (existingCourse.day === thaiDay && !existingCourse.no_time) {
            if (startHour < existingCourse.end && endHour > existingCourse.start) {
                isOverlap = true; overlapCourseName = existingCourse.code; break; 
            }
        }
    }

    if (isOverlap) return alert(`⚠️ ไม่สามารถเพิ่มวิชานี้ได้!\nเวลาเรียนทับซ้อนกับวิชา ${overlapCourseName}`);

    const formatCustomExam = (d, s, e) => {
        if (!d) return "-";
        const dateParts = d.split('-'); 
        if(dateParts.length !== 3) return "-";
        const yearTH = parseInt(dateParts[0]) + 543;
        let formattedDate = `${dateParts[2]}/${dateParts[1]}/${yearTH}`;
        let timeText = (s && e) ? ` เวลา ${s}-${e} น.` : "";
        return formattedDate + timeText;
    };

    const uniqueId = `CUSTOM_${Date.now()}`;
    selectedCourseIds.push(uniqueId);
    selectedCoursesData.push({
        id: uniqueId, code: code, name: name, credits: 0, day: thaiDay, start: startHour, end: endHour,
        custom_mid_text: formatCustomExam(midDate, midStart, midEnd),
        custom_fin_text: formatCustomExam(finDate, finStart, finEnd),
        no_time: false
    });

    updateDatabaseTimetableAndCredits();
    document.getElementById('modal-custom-course').style.display = 'none';
    
    document.getElementById('custom-code').value = ''; document.getElementById('custom-name').value = '';
    document.getElementById('custom-course-search').value = ''; document.getElementById('custom-mid-date').value = ''; 
    document.getElementById('custom-mid-start').value = ''; document.getElementById('custom-mid-end').value = '';
    document.getElementById('custom-fin-date').value = ''; document.getElementById('custom-fin-start').value = ''; 
    document.getElementById('custom-fin-end').value = '';

    showSuccessModal('เพิ่มรายวิชาสำเร็จ!', `เพิ่มวิชา ${code} ลงตารางเรียบร้อยแล้วครับ`);
};

// ==========================================
// 🚀 ฟังก์ชันดึงตารางเรียนจากเพื่อน
// ==========================================
window.confirmImportSchedule = function() {
    const targetYear = parseInt(document.getElementById('import-year').value);
    const targetSemester = parseInt(document.getElementById('import-semester').value);
    const targetKey = `${targetYear}_${targetSemester}`;

    const sharedCourseCodes = ["1101041", "IST201006", "1101911"];
    let addedCount = 0;

    if (targetYear === currentYearLevel && targetSemester === currentSemester) {
        sharedCourseCodes.forEach(courseCode => {
            const cleanCode = normalizeCourseCodeKey(courseCode);
            const foundCourse = allCourses.find(c => normalizeCourseCodeKey(c.COURSECODE) === cleanCode) || masterCourses.find(c => normalizeCourseCodeKey(c.COURSECODE) === cleanCode);
            
            if(foundCourse && !selectedCoursesData.some(c => c.code.includes(foundCourse.COURSECODE))) {
                const uniqueId = `SHARED_${foundCourse.COURSECODE}_${Date.now()}`;
                let startHour = parseInt((foundCourse.START_TIME || '09:00').split(':')[0]);
                let endHour = parseInt((foundCourse.END_TIME || '12:00').split(':')[0]);

                selectedCourseIds.push(uniqueId);
                selectedCoursesData.push({
                    id: uniqueId, code: `${foundCourse.COURSECODE} (G.${foundCourse.SECTION || '1'})`, name: foundCourse.COURSENAME,
                    credits: parseInt(String(foundCourse.COURSEUNIT).split(' ')[0]) || 0,
                    day: foundCourse.DAY_NAME || '-', start: startHour, end: endHour, no_time: !(foundCourse.START_TIME && foundCourse.END_TIME)
                });
                addedCount++;
            }
        });
        if (addedCount > 0) updateDatabaseTimetableAndCredits();
    } else {
        if (!scheduleCache[targetKey]) scheduleCache[targetKey] = { ids: [], data: [] };
        
        sharedCourseCodes.forEach(courseCode => {
            const cleanCode = normalizeCourseCodeKey(courseCode);
            const foundCourse = masterCourses.find(c => normalizeCourseCodeKey(c.COURSECODE) === cleanCode);
            
            if(foundCourse && !scheduleCache[targetKey].data.some(c => c.code.includes(foundCourse.COURSECODE))) {
                const uniqueId = `SHARED_${foundCourse.COURSECODE}_${Date.now()}`;
                scheduleCache[targetKey].ids.push(uniqueId);
                scheduleCache[targetKey].data.push({
                    id: uniqueId, code: `${foundCourse.COURSECODE} (G.${foundCourse.SECTION || '1'})`, name: foundCourse.COURSENAME,
                    credits: parseInt(String(foundCourse.COURSEUNIT).split(' ')[0]) || 0,
                    day: foundCourse.DAY_NAME || '-', start: 9, end: 12, no_time: false
                });
                addedCount++;
            }
        });
    }

    closeModal('modal-import-schedule');
    alert(addedCount > 0 ? `นำเข้าตารางเรียนไปยัง ปี ${targetYear} เทอม ${targetSemester} สำเร็จ!` : `วิชาเหล่านี้มีอยู่แล้วใน ปี ${targetYear} เทอม ${targetSemester}`);
};

// ---------------------------------------------------------
// ส่วนของระบบรีวิว
// ---------------------------------------------------------
function initReviewSystem() {
    const reviewGrid = document.getElementById('review-grid');
    const searchInput = document.getElementById('review-search');
    const mainPage = document.getElementById('review-main-page');
    const detailPage = document.getElementById('review-detail-page');
    const backBtn = document.getElementById('back-to-reviews');
    const courseTitle = document.getElementById('review-course-title');
    const commentsGrid = document.getElementById('review-comments-grid');

    let courseRatings = {};
    let typingTimer;
    let currentReviewCode = '';
    let currentReviewName = '';
    let selectedRating = 0;

    async function fetchAllRatings() {
        const { data, error } = await supabaseClient.from('course_reviews').select('course_code, rating');
        if (!error && data) {
            const grouped = data.reduce((acc, curr) => {
                if (!acc[curr.course_code]) acc[curr.course_code] = { sum: 0, count: 0 };
                acc[curr.course_code].sum += curr.rating;
                acc[curr.course_code].count += 1;
                return acc;
            }, {});
            for (const code in grouped) courseRatings[code] = Math.round(grouped[code].sum / grouped[code].count);
        }
        fetchCoursesFromAPI('');
    }

    const generateStars = (score) => {
        let starsHTML = '';
        for(let i=1; i<=5; i++) starsHTML += i <= score ? '<i class="fa-solid fa-star" style="color: #f59e0b;"></i> ' : '<i class="fa-regular fa-star" style="color: #d1d5db;"></i> ';
        return `<div class="stars" style="margin-bottom: 0;">${starsHTML}</div>`;
    };

    async function fetchCoursesFromAPI(keyword = '') {
        if (!reviewGrid) return;
        try {
            // 🔥 แก้ไข: เติม /api/courses ให้สมบูรณ์
            const response = await fetch(`https://transfer-matcher-cable.ngrok-free.dev/api/courses`);
            const result = await response.json();
            reviewGrid.innerHTML = '';

            if (result.status === 'success' && result.data.length > 0) {
                const cleanKeyword = keyword.replace(/\s+/g, '').toLowerCase();
                const matchedData = result.data.filter(c => {
                    const cleanCode = (c.COURSECODE || '').replace(/\s+/g, '').toLowerCase();
                    const cleanName = (c.COURSENAME || '').toLowerCase();
                    return cleanCode.includes(cleanKeyword) || cleanName.includes(cleanKeyword);
                });

                const uniqueCourses = [];
                const seen = new Set();
                matchedData.forEach(c => {
                    if(!seen.has(c.COURSECODE) && uniqueCourses.length < 30) {
                        seen.add(c.COURSECODE);
                        uniqueCourses.push(c);
                    }
                });

                if(uniqueCourses.length === 0) {
                    reviewGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #9ca3af; padding: 40px;">ไม่พบรายวิชาที่ค้นหา</div>`;
                    return;
                }

                uniqueCourses.forEach(course => {
                    const card = document.createElement('div');
                    card.className = 'review-card';
                    const avgRating = courseRatings[course.COURSECODE] || 0;
                    const noReviewText = avgRating === 0 ? '<span style="font-size:11px; color:#9ca3af; margin-left:8px;">(ยังไม่มีรีวิว)</span>' : '';

                    card.innerHTML = `
                        <div style="display: flex; align-items: center; margin-bottom: 12px;">${generateStars(avgRating)} ${noReviewText}</div>
                        <h3 style="font-size: 18px; color: #111; margin: 0 0 8px 0;">${window.formatCourseCodeDisplay(course.COURSECODE)}</h3>
                        <div style="font-size: 14px; color: #4b5563; font-weight: 500; margin-bottom: 5px;">${course.COURSENAME}</div>
                        <div style="font-size: 12px; color: #9ca3af; margin-top: 15px;">คลิกเพื่อดูรายละเอียดการรีวิว</div>
                    `;
                    card.onclick = () => openCourseDetail(course.COURSECODE, course.COURSENAME);
                    reviewGrid.appendChild(card);
                });
            } else {
                reviewGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #9ca3af; padding: 40px;">ไม่พบรายวิชาที่ค้นหา</div>`;
            }
        } catch (error) {
            reviewGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #ef4444; padding: 40px;">ไม่สามารถเชื่อมต่อฐานข้อมูลได้</div>`;
        }
    }

    async function openCourseDetail(code, name) {
        currentReviewCode = code; currentReviewName = name;
        mainPage.style.display = 'none'; detailPage.style.display = 'block';
        courseTitle.innerHTML = `รายวิชา<br><span style="color:#F05A28;">${window.formatCourseCodeDisplay(code)}</span> ${name}`;
        commentsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 40px; color:#9ca3af;"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดรีวิว...</div>';

        const { data: reviews, error } = await supabaseClient.from('course_reviews').select('*').eq('course_code', code).order('created_at', { ascending: false });

        commentsGrid.innerHTML = '';
        if(error || !reviews || reviews.length === 0) {
            commentsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #9ca3af; padding: 40px; background: white; border-radius: 12px; border: 1px dashed #d1d5db;">ยังไม่มีรีวิวสำหรับวิชานี้ เป็นคนแรกที่รีวิวสิ!</div>`;
            return;
        }

        reviews.forEach(rev => {
            const reviewerName = rev.student_id; 
            const dateObj = rev.created_at ? new Date(rev.created_at) : new Date();
            const dateStr = dateObj.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
            const initial = reviewerName.charAt(0).toUpperCase();

            commentsGrid.innerHTML += `
                <div class="comment-card">
                    <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                        <div style="width: 45px; height: 45px; background: #10b981; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: bold;">${initial}</div>
                        <div><div style="font-weight: 600; color: #111; font-size: 15px;">${reviewerName}</div><div style="color: #9ca3af; font-size: 12px;">on ${dateStr}</div></div>
                    </div>
                    <div style="margin-bottom: 12px;">${generateStars(rev.rating)}</div>
                    <div style="font-size: 14px; color: #4b5563; line-height: 1.5;">${rev.review_text}</div>
                </div>
            `;
        });
    }

    const interactiveStars = document.querySelectorAll('#interactive-stars i');
    function highlightStars(val) {
        interactiveStars.forEach(s => {
            if (parseInt(s.getAttribute('data-value')) <= val) {
                s.style.color = '#f59e0b'; s.classList.remove('fa-regular'); s.classList.add('fa-solid');
            } else {
                s.style.color = '#d1d5db'; s.classList.remove('fa-solid'); s.classList.add('fa-regular');
            }
        });
    }

    if(interactiveStars) {
        interactiveStars.forEach(star => {
            star.addEventListener('mouseover', function() { highlightStars(this.getAttribute('data-value')); });
            star.addEventListener('mouseout', function() { highlightStars(selectedRating); });
            star.addEventListener('click', function() { selectedRating = parseInt(this.getAttribute('data-value')); highlightStars(selectedRating); });
        });
    }

    const btnOpenWriteReview = document.getElementById('btn-open-write-review');
    if(btnOpenWriteReview) {
        btnOpenWriteReview.addEventListener('click', () => {
            selectedRating = 0; highlightStars(0);
            document.getElementById('review-text-input').value = '';
            document.getElementById('write-review-course-title').innerText = `${window.formatCourseCodeDisplay(currentReviewCode)} ${currentReviewName}`;
            document.getElementById('modal-write-review').style.display = 'flex';
        });
    }

    const submitReviewBtn = document.getElementById('submit-review-btn');
    if(submitReviewBtn) {
        submitReviewBtn.onclick = async () => {
            if (selectedRating === 0) return alert('กรุณาให้คะแนนดาววิชานี้ก่อนครับ ⭐');
            const text = document.getElementById('review-text-input').value.trim();
            if (!text) return alert('กรุณาเขียนรายละเอียดการรีวิวครับ');

            const studentId = localStorage.getItem('sut_student_id');
            const originalText = submitReviewBtn.innerHTML;
            submitReviewBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';
            submitReviewBtn.disabled = true;

            try {
                const { error } = await supabaseClient.from('course_reviews').insert([{ course_code: currentReviewCode, student_id: studentId, rating: selectedRating, review_text: text, created_at: new Date().toISOString() }]);
                if (error) throw error;
                document.getElementById('modal-write-review').style.display = 'none';
                showSuccessModal('บันทึกสำเร็จ!', 'ขอบคุณที่ร่วมแบ่งปันรีวิวรายวิชานะครับ');
                openCourseDetail(currentReviewCode, currentReviewName);
                if (typeof fetchAllRatings === 'function') fetchAllRatings(); 
            } catch (err) { alert('เกิดข้อผิดพลาดในการบันทึก: ' + err.message); } 
            finally { submitReviewBtn.innerHTML = originalText; submitReviewBtn.disabled = false; }
        };
    }

    if(searchInput) {
        searchInput.addEventListener('input', (e) => {
            reviewGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #9ca3af;"><i class="fa-solid fa-spinner fa-spin"></i> กำลังค้นหา...</div>';
            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => { fetchCoursesFromAPI(e.target.value); }, 400); 
        });
    }

    if(backBtn) backBtn.addEventListener('click', () => { detailPage.style.display = 'none'; mainPage.style.display = 'block'; });

    fetchAllRatings();
}

async function checkUserSession() {
    const studentId = localStorage.getItem('sut_student_id');
    if (!studentId) { window.location.href = 'auth.html'; return; }
    loadSchedule();
}

// ==========================================
// 1. ฟังก์ชันบันทึกข้อมูลส่วนตัวลงฐานข้อมูลจริง
// ==========================================
async function saveProfile() { 
    const studentId = localStorage.getItem('sut_student_id');
    if (!studentId) return alert('กรุณาเข้าสู่ระบบก่อนทำการบันทึกครับ');

    const btn = document.getElementById('save-profile-btn');
    if (!btn) return;
    
    // เปลี่ยนสถานะปุ่มตอนกำลังเซฟ
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';
    btn.disabled = true;

    // ดึงข้อมูลจากหน้าจอ
    const age = document.getElementById('profile-age') ? document.getElementById('profile-age').value : '';
    const freeTime = document.getElementById('profile-freetime') ? document.getElementById('profile-freetime').value : '';
    const mbti = document.getElementById('profile-mbti') ? document.getElementById('profile-mbti').value : '';
    const learningStyle = document.getElementById('profile-learning-style') ? document.getElementById('profile-learning-style').value : '';
    const socialMedia = document.getElementById('profile-social') ? document.getElementById('profile-social').value : '';

    try {
        // ส่งข้อมูลขึ้น Supabase
        const { error } = await supabaseClient
            .from('profiles')
            .update({
                age: age,
                free_time: freeTime,
                mbti: mbti,
                learning_style: learningStyle,
                social_media: socialMedia
            })
            .eq('student_id', studentId);

        if (error) throw error;
        
        // เซฟเสร็จแล้วค่อยเด้งแจ้งเตือน
        showSuccessModal('สำเร็จ!', 'บันทึกข้อมูลส่วนตัวลงระบบเรียบร้อยแล้ว');
    } catch (error) {
        console.error("Save profile error:", error);
        alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + error.message);
    } finally {
        // คืนค่าปุ่มกลับเป็นเหมือนเดิม
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ==========================================
// 2. ฟังก์ชันส่งข้อความแชทเข้าห้องรวม / ห้องส่วนตัว
// ==========================================
async function sendCommunityMessage() {
    const inputEl = document.getElementById('community-msg-input');
    if (!inputEl) return;
    
    const msg = inputEl.value.trim();
    if (!msg) return; 

    if (!currentChatRoomId) {
        alert('กรุณาเลือกห้องแชทเพื่อนด้านซ้ายมือก่อนส่งข้อความครับ');
        return;
    }

    const studentId = localStorage.getItem('sut_student_id');
    const originalText = inputEl.value;
    
    // เคลียร์ช่องพิมพ์ทันทีให้รู้สึกว่าส่งแล้ว
    inputEl.value = ''; 

    try {
        const { error } = await supabaseClient.from('chat_messages').insert([
            { room_id: currentChatRoomId, sender_id: studentId, message: msg }
        ]);
        
        if (error) {
            inputEl.value = originalText; // ถ้าเน็ตหลุด/ส่งไม่สำเร็จ คืนข้อความกลับมาให้
            throw error;
        }
    } catch (err) {
        console.error("Send message error:", err);
        alert('ส่งข้อความไม่สำเร็จ: ' + err.message);
    }
}

window.logoutUser = async function() {
    if (!confirm('ต้องการออกจากระบบใช่หรือไม่?')) return;
    localStorage.removeItem('sut_student_id');
    window.location.href = 'auth.html';
};

document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);
});

window.openModal = function(id) { document.getElementById(id).style.display = 'flex'; };
window.closeModal = function(id) { document.getElementById(id).style.display = 'none'; };
window.onclick = function(event) { if (event.target.classList.contains('chat-modal')) event.target.style.display = "none"; };

// ==========================================
// ระบบ Community Chat
// ==========================================
let currentChatRoomId = null;
let publicRoomId = null; 
let chatSubscription = null;
let base64GroupImage = null;

document.addEventListener('DOMContentLoaded', () => {
    const commInput = document.getElementById('community-msg-input');
    const commSendBtn = document.querySelector('.send-msg-btn');
    if (commInput && commSendBtn) {
        commSendBtn.addEventListener('click', sendCommunityMessage);
        commInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendCommunityMessage(); });
    }
});

// ==========================================
// 📌 ฟังก์ชันปักหมุดแชท
// ==========================================
window.togglePinChat = function(roomId, event) {
    event.stopPropagation(); // ป้องกันไม่ให้คลิกปุ่มปักหมุดแล้วเด้งเปิดห้องแชท
    const myId = localStorage.getItem('sut_student_id');
    let pinned = JSON.parse(localStorage.getItem(`pinned_chats_${myId}`) || '[]');
    
    if (pinned.includes(roomId)) {
        pinned = pinned.filter(id => id !== roomId); // เลิกปักหมุด
    } else {
        pinned.push(roomId); // ปักหมุด
    }
    
    localStorage.setItem(`pinned_chats_${myId}`, JSON.stringify(pinned));
    loadChatRooms(); // รีเฟรชรายชื่อแชทใหม่เพื่อให้ห้องปักหมุดเด้งขึ้นบนสุด
};

// ==========================================
// 🔄 โหลดรายชื่อห้องแชท (อัปเกรด UI สไตล์ Messenger + ปักหมุด)
// ==========================================
async function loadChatRooms() {
    const myId = localStorage.getItem('sut_student_id');
    const sidebarList = document.querySelector('.chat-sidebar-left') || document.querySelector('div[style*="width: 250px"]');
    if (!myId) return;

    try {
        const { data: myMemberships, error: memberErr } = await supabaseClient.from('chat_room_members').select('room_id').eq('student_id', myId).eq('status', 'joined');
        if (memberErr) throw memberErr;

        // ปรับ Header เป็นคำว่า "แชท" และทำ UI ให้ดูโมเดิร์น สว่างตา
        if (sidebarList) {
            sidebarList.style.backgroundColor = '#ffffff';
            sidebarList.style.borderRight = '1px solid #e5e7eb';
            sidebarList.innerHTML = `
                <div style="padding: 20px 15px 10px 15px; font-size: 22px; font-weight: 700; color: #111827; display: flex; justify-content: space-between; align-items: center; background: #ffffff; z-index: 10; position: sticky; top: 0;">
                    แชท
                </div>
                <div id="room-list-container" style="padding: 10px; overflow-y: auto; height: calc(100% - 60px);"></div>
            `;
        }
        
        const roomContainer = document.getElementById('room-list-container');
        if (!roomContainer) return;

        if (!myMemberships || myMemberships.length === 0) {
            roomContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #9ca3af; font-size: 13px;">ยังไม่มีการพูดคุย</div>';
        } else {
            const roomIds = myMemberships.map(m => m.room_id);
            const { data: rooms, error: roomErr } = await supabaseClient.from('chat_rooms').select('id, name, is_private').in('id', roomIds);
            if (roomErr) throw roomErr;

            // ดึงข้อมูลการปักหมุดจากความจำเบราว์เซอร์
            let pinnedChats = JSON.parse(localStorage.getItem(`pinned_chats_${myId}`) || '[]');
            
            // จัดเรียง: ปักหมุดขึ้นก่อน ตามด้วยแชทปกติ
            let sortedRooms = rooms.sort((a, b) => {
                let aPinned = pinnedChats.includes(a.id);
                let bPinned = pinnedChats.includes(b.id);
                if (aPinned && !bPinned) return -1;
                if (!aPinned && bPinned) return 1;
                return 0;
            });

            sortedRooms.forEach(room => {
                let isPinned = pinnedChats.includes(room.id);
                let pinIconHtml = isPinned ? 
                    `<i class="fa-solid fa-thumbtack" style="color: #F05A28; font-size: 14px; transform: rotate(45deg);"></i>` : 
                    `<i class="fa-solid fa-thumbtack" style="color: #d1d5db; font-size: 14px; opacity: 0; transition: 0.2s;" class="pin-icon"></i>`;

                let displayName = room.name;
                let initial = room.name.charAt(0).toUpperCase();
                let avatarBg = '#f3f4f6';
                let avatarColor = '#4b5563';
                let statusDot = '';

                // สร้างสไตล์รูปโปรไฟล์แบบกลมโต สไตล์ Messenger / Instagram
                if (room.name.startsWith('DM_')) {
                    const ids = room.name.replace('DM_', '').split('_');
                    const friendId = ids[0] === myId ? ids[1] : ids[0];
                    displayName = `${friendId}`;
                    initial = friendId.charAt(0).toUpperCase();
                    avatarBg = 'linear-gradient(135deg, #60a5fa, #3b82f6)';
                    avatarColor = 'white';
                    statusDot = `<div style="position:absolute; bottom: 0px; right: 0px; width: 13px; height: 13px; background: #10b981; border: 2.5px solid white; border-radius: 50%;"></div>`;
                } else {
                    // กลุ่มทั่วไป
                    avatarBg = room.is_private ? 'linear-gradient(135deg, #a78bfa, #8b5cf6)' : 'linear-gradient(135deg, #fca5a5, #ef4444)';
                    avatarColor = 'white';
                    initial = room.is_private ? '<i class="fa-solid fa-lock" style="font-size:16px;"></i>' : '<i class="fa-solid fa-users" style="font-size:16px;"></i>';
                }

                const isActive = currentChatRoomId === room.id;
                const activeBg = isActive ? "#fef2f2" : "transparent";

                roomContainer.innerHTML += `
                    <div class="chat-room-item" onclick="selectChatRoom('${room.id}', '${displayName}')" style="padding: 10px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 10px; border-radius: 12px; transition: background 0.2s; margin-bottom: 4px; background: ${activeBg};" onmouseover="this.style.background='#f3f4f6'; this.querySelector('.pin-icon')?.style.setProperty('opacity', '1');" onmouseout="if(!${isActive}) this.style.background='transparent'; if(!${isPinned}) this.querySelector('.pin-icon')?.style.setProperty('opacity', '0');">
                        <div style="display: flex; align-items: center; gap: 12px; overflow: hidden; width: 100%;">
                            <div style="width: 50px; height: 50px; min-width: 50px; border-radius: 50%; background: ${avatarBg}; color: ${avatarColor}; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: bold; position: relative; box-shadow: 0 2px 5px rgba(0,0,0,0.08);">
                                ${initial}
                                ${statusDot}
                            </div>
                            <div style="display: flex; flex-direction: column; overflow: hidden; justify-content: center;">
                                <span style="font-size: 15px; font-weight: ${isActive || isPinned ? '600' : '500'}; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">${displayName}</span>
                                <span style="font-size: 13px; color: ${isActive ? '#F05A28' : '#6b7280'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 4px;">แตะเพื่อเปิดแชท...</span>
                            </div>
                        </div>
                        <button onclick="togglePinChat('${room.id}', event)" style="background: transparent; border: none; cursor: pointer; padding: 5px; display: flex; align-items: center; justify-content: center;" title="${isPinned ? 'เลิกปักหมุด' : 'ปักหมุด'}">
                            ${pinIconHtml}
                        </button>
                    </div>
                `;
            });
        }
    } catch (err) { console.error("Error loading chat rooms:", err); } 
    finally { await loadFriendsData(); }
}

let currentRoomRole = 'member';
let currentRoomIsPrivate = false;
let currentActualRoomName = '';
let currentFriendIdInDM = '';

window.selectChatRoom = async function(roomId, roomName) {
    currentChatRoomId = roomId; 
    publicRoomId = roomId; 
    document.getElementById('current-room-title').innerText = roomName;
    
    const myId = localStorage.getItem('sut_student_id');
    const { data: memberData } = await supabaseClient.from('chat_room_members').select('role').eq('room_id', roomId).eq('student_id', myId).single();
    currentRoomRole = memberData ? memberData.role : 'member';
    
    const { data: roomData } = await supabaseClient.from('chat_rooms').select('is_private, name').eq('id', roomId).single();
    if(roomData) { currentRoomIsPrivate = roomData.is_private; currentActualRoomName = roomData.name; }

    document.getElementById('btn-group-info').style.display = 'block'; 
    await loadChatRooms(); 
    document.querySelector('.chat-history').innerHTML = `<div style="text-align:center; color:#999; margin-top:20px;">กำลังโหลดประวัติ...</div>`;
    await loadMessages(roomId);
    subscribeToChat(roomId);
};

async function loadMessages(roomId) {
    const { data: messages, error } = await supabaseClient.from('chat_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: true });
    const chatBox = document.querySelector('.chat-history');
    if (chatBox) chatBox.innerHTML = ''; 
    if (messages && messages.length > 0) messages.forEach(msg => renderSingleMessage(msg));
}

// ==========================================
// 💬 ฟังก์ชันวาดข้อความแชท (รองรับการแสดงการ์ดแชร์ตารางเรียน)
// ==========================================
function renderSingleMessage(msg) {
    const chatBox = document.querySelector('.chat-history');
    if (!chatBox) return;

    const myId = localStorage.getItem('sut_student_id');
    const isMe = msg.sender_id === myId;

    const msgDiv = document.createElement('div');
    msgDiv.style.padding = '10px 15px';
    msgDiv.style.borderRadius = isMe ? '10px 10px 0 10px' : '10px 10px 10px 0';
    msgDiv.style.marginBottom = '10px';
    msgDiv.style.width = 'fit-content';
    msgDiv.style.maxWidth = '70%';
    msgDiv.style.wordBreak = 'break-word';
    msgDiv.style.fontSize = '14px';

    // เช็คว่าข้อความนี้เป็นการแชร์ตารางเรียน (ซ่อนโค้ดไว้ใต้คำว่า SYS_SHARE)
    if (msg.message && msg.message.startsWith('SYS_SHARE:')) {
        try {
            const jsonStr = msg.message.replace('SYS_SHARE:', '');
            const payload = JSON.parse(jsonStr);
            const safeJson = JSON.stringify(payload.courses).replace(/'/g, "&#39;").replace(/"/g, "&quot;");
            
            msgDiv.style.background = isMe ? '#F05A28' : '#ffffff';
            msgDiv.style.color = isMe ? 'white' : '#333';
            msgDiv.style.marginLeft = isMe ? 'auto' : '0';
            msgDiv.style.border = isMe ? 'none' : '1px solid #e5e7eb';
            msgDiv.style.boxShadow = '0 2px 5px rgba(0,0,0,0.05)';

            let headerHtml = isMe ? '' : `<strong style="font-size: 11px; color: #F05A28; display: block; margin-bottom: 8px;"><i class="fa-solid fa-user"></i> ${msg.sender_id}</strong>`;
            
            msgDiv.innerHTML = `
                ${headerHtml}
                <div style="background: ${isMe ? 'rgba(255,255,255,0.2)' : '#f9fafb'}; padding: 12px; border-radius: 8px; text-align: center; border: 1px solid ${isMe ? 'rgba(255,255,255,0.3)' : '#e5e7eb'}; min-width: 220px;">
                    <div style="font-size: 32px; margin-bottom: 5px;">📅</div>
                    <div style="font-weight: 600; margin-bottom: 2px;">ตารางเรียนของ${isMe ? 'ฉัน' : 'เพื่อน'}</div>
                    <div style="font-size: 12px; margin-bottom: 12px; opacity: 0.9;">ปี ${payload.year} เทอม ${payload.sem}</div>
                    <button onclick="importSharedSchedule('${safeJson}', ${payload.year}, ${payload.sem})" style="background: ${isMe ? 'white' : '#10b981'}; color: ${isMe ? '#F05A28' : 'white'}; border: none; padding: 8px 15px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'Prompt', sans-serif; width: 100%; transition: 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
                        <i class="fa-solid fa-download"></i> ${isMe ? 'เช็คข้อมูลตาราง' : 'ดึงตารางนี้ลงระบบ'}
                    </button>
                </div>
            `;
        } catch(e) {
            msgDiv.innerText = "แชร์ตารางเรียน (ข้อมูลขัดข้อง)";
        }
    } else {
        // ข้อความแชทปกติ
        if (isMe) {
            msgDiv.style.background = '#F05A28'; msgDiv.style.color = 'white'; msgDiv.style.marginLeft = 'auto'; msgDiv.innerText = msg.message;
        } else {
            msgDiv.style.background = '#E0E0E0'; msgDiv.style.color = '#333'; msgDiv.innerHTML = `<strong style="font-size: 11px; color: #F05A28; display: block; margin-bottom: 2px;">${msg.sender_id}</strong>${msg.message}`;
        }
    }

    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function subscribeToChat(roomId) {
    if (chatSubscription) supabaseClient.removeChannel(chatSubscription);
    chatSubscription = supabaseClient
        .channel('public-room')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` }, payload => { renderSingleMessage(payload.new); })
        .subscribe();
}

window.createNewGroup = async function() {
    const nameInput = document.getElementById('new-group-name');
    const typeSelect = document.getElementById('new-group-type');
    if (!nameInput || nameInput.value.trim() === '') { alert('⚠️ กรุณากรอกชื่อกลุ่มครับ'); return; }

    const groupName = nameInput.value.trim();
    const isPrivate = typeSelect ? typeSelect.value.includes('ส่วนตัว') : false; 
    const studentId = localStorage.getItem('sut_student_id');

    try {
        const { data: newRoom, error: roomError } = await supabaseClient.from('chat_rooms').insert([{ name: groupName, is_private: isPrivate, created_by: studentId }]).select().single();
        if (roomError) throw roomError;
        const { error: memberError } = await supabaseClient.from('chat_room_members').insert([{ room_id: newRoom.id, student_id: studentId, role: 'admin', status: 'joined' }]);
        if (memberError) throw memberError;

        showSuccessModal('สำเร็จ!', `สร้างกลุ่ม "${groupName}" สำเร็จ!`);
        document.getElementById('modal-create-group').style.display = 'none';
        nameInput.value = '';
        loadChatRooms();
    } catch (error) { alert("เกิดข้อผิดพลาดในการสร้างกลุ่ม: " + error.message); }
};

window.searchCommunity = async function() {
    const searchInput = document.getElementById('search-community-input');
    const resultsContainer = document.getElementById('search-community-results');
    const searchBtn = document.getElementById('btn-run-search');
    
    if (!searchInput || !resultsContainer) return;
    const keyword = searchInput.value.trim();
if (!keyword) { 
    showErrorModal('ข้อมูลไม่ครบถ้วน', 'กรุณาพิมพ์ <b>รหัสนักศึกษา</b> หรือ <b>ชื่อกลุ่ม</b> ลงในช่องค้นหาก่อนกดปุ่มค้นหานะครับ'); 
    return; 
}
    const myStudentId = localStorage.getItem('sut_student_id');
    const originalText = searchBtn.innerText;
    searchBtn.innerText = 'กำลังค้นหา...';
    searchBtn.disabled = true;

    try {
        const { data: users, error: userError } = await supabaseClient.from('profiles').select('student_id, first_name, last_name').neq('student_id', myStudentId).or(`student_id.ilike.%${keyword}%,first_name.ilike.%${keyword}%,last_name.ilike.%${keyword}%`).limit(10);
        if (userError) throw userError;

        const { data: rooms, error: roomError } = await supabaseClient.from('chat_rooms').select('id, name, is_private').ilike('name', `%${keyword}%`).limit(10);
        if (roomError) throw roomError;

        renderSearchResults(users || [], rooms || []);
    } catch (error) { resultsContainer.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 20px;">เกิดข้อผิดพลาด: ${error.message}</div>`; } 
    finally { searchBtn.innerText = originalText; searchBtn.disabled = false; }
};

function renderSearchResults(users, rooms) {
    const container = document.getElementById('search-community-results');
    if (!container) return;
    container.innerHTML = '';

    if (users.length === 0 && rooms.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #9ca3af; padding: 30px 0;">ไม่พบข้อมูลที่ค้นหา</div>';
        return;
    }

    const userSection = document.createElement('div');
    userSection.innerHTML = `<div style="font-size: 13px; font-weight: 600; color: #6b7280; margin-bottom: 8px;"><i class="fa-solid fa-user"></i> เพื่อน (${users.length})</div>`;
    if (users.length === 0) { userSection.innerHTML += `<div style="font-size: 12px; color: #9ca3af; padding: 6px 10px;">ไม่พบรายชื่อเพื่อน</div>`; } 
    else {
        users.forEach(u => {
            const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'ไม่ระบุชื่อ';
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 6px;';
            item.innerHTML = `
                <div><div style="font-weight: 600; font-size: 14px; color: #1f2937;">${u.student_id}</div><div style="font-size: 12px; color: #6b7280;">${name}</div></div>
                <button onclick="sendFriendRequest('${u.student_id}')" style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: 'Prompt', sans-serif;"><i class="fa-solid fa-user-plus"></i> เพิ่มเพื่อน</button>
            `;
            userSection.appendChild(item);
        });
    }
    container.appendChild(userSection);

    const roomSection = document.createElement('div');
    roomSection.innerHTML = `<div style="font-size: 13px; font-weight: 600; color: #6b7280; margin-bottom: 8px;"><i class="fa-solid fa-users"></i> กลุ่มแชท (${rooms.length})</div>`;
    if (rooms.length === 0) { roomSection.innerHTML += `<div style="font-size: 12px; color: #9ca3af; padding: 6px 10px;">ไม่พบกลุ่มแชท</div>`; } 
    else {
        rooms.forEach(r => {
            const badge = r.is_private ? `<span style="background: #f3f4f6; color: #4b5563; font-size: 11px; padding: 2px 8px; border-radius: 12px;"><i class="fa-solid fa-lock"></i> ส่วนตัว</span>` : `<span style="background: #ecfdf5; color: #059669; font-size: 11px; padding: 2px 8px; border-radius: 12px;"><i class="fa-solid fa-globe"></i> สาธารณะ</span>`;
            const btnAction = r.is_private ? `<button onclick="requestJoinPrivateGroup('${r.id}', '${r.name}')" style="background: #6366f1; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: 'Prompt', sans-serif;"><i class="fa-solid fa-paper-plane"></i> ขอเข้าร่วม</button>` : `<button onclick="joinPublicGroupDirect('${r.id}', '${r.name}')" style="background: #F05A28; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: 'Prompt', sans-serif;"><i class="fa-solid fa-arrow-right-to-bracket"></i> เข้ากลุ่ม</button>`;
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 6px;';
            item.innerHTML = `<div><div style="font-weight: 600; font-size: 14px; color: #1f2937; display: flex; align-items: center; gap: 6px;">${r.name} ${badge}</div></div>${btnAction}`;
            roomSection.appendChild(item);
        });
    }
    container.appendChild(roomSection);
}

window.sendFriendRequest = async function(targetStudentId) {
    const myStudentId = localStorage.getItem('sut_student_id');
    try {
        const { data: existing } = await supabaseClient.from('friendships').select('*').or(`and(requester_id.eq.${myStudentId},receiver_id.eq.${targetStudentId}),and(requester_id.eq.${targetStudentId},receiver_id.eq.${myStudentId})`);
        if (existing && existing.length > 0) return alert('คุณและผู้ใช้นี้มีความสัมพันธ์หรือส่งคำขอกันอยู่แล้วครับ');
        const { error } = await supabaseClient.from('friendships').insert([{ requester_id: myStudentId, receiver_id: targetStudentId, status: 'pending' }]);
        if (error) throw error;
        showSuccessModal('สำเร็จ!', `ส่งคำขอเป็นเพื่อนกับ ${targetStudentId} แล้ว!`);
    } catch (err) { alert('เกิดข้อผิดพลาดในการส่งคำขอ: ' + err.message); }
};

window.joinPublicGroupDirect = async function(roomId, roomName) {
    const myStudentId = localStorage.getItem('sut_student_id');
    try {
        await supabaseClient.from('chat_room_members').upsert([{ room_id: roomId, student_id: myStudentId, role: 'member', status: 'joined' }], { onConflict: 'room_id,student_id' });
        closeModal('modal-add-friend');
        await loadChatRooms();
        selectChatRoom(roomId, roomName);
    } catch (err) { alert('ไม่สามารถเข้ากลุ่มได้: ' + err.message); }
};

window.requestJoinPrivateGroup = async function(roomId, roomName) {
    const myStudentId = localStorage.getItem('sut_student_id');
    try {
        const { error } = await supabaseClient.from('chat_room_members').insert([{ room_id: roomId, student_id: myStudentId, role: 'member', status: 'pending' }]);
        if (error) throw error;
        showSuccessModal('สำเร็จ!', `ส่งคำขอเข้าร่วมกลุ่ม "${roomName}" แล้ว รอแอดมินอนุมัติครับ`);
    } catch (err) { alert('ส่งคำขอไม่สำเร็จ หรือคุณเคยส่งคำขอไปแล้ว: ' + err.message); }
};

let bgCropper = null;
window.changeProfileBackground = function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const modal = document.getElementById('crop-bg-modal');
            const imageTarget = document.getElementById('crop-image-target');
            imageTarget.src = e.target.result;
            modal.style.display = 'flex';
            if (bgCropper) bgCropper.destroy();
            bgCropper = new Cropper(imageTarget, { viewMode: 1, autoCropArea: 1, zoomable: true, scalable: true, background: false });
        };
        reader.readAsDataURL(file);
    }
    event.target.value = '';
};
window.applyBgCrop = function() {
    if (!bgCropper) return;
    const canvas = bgCropper.getCroppedCanvas({ width: 1920, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
    const croppedImageURL = canvas.toDataURL('image/jpeg', 0.8); // ลดขนาดไฟล์เล็กน้อยเพื่อประหยัดพื้นที่ความจำ
    const bgContainer = document.getElementById('profile-bg-container');
    
    if (bgContainer) { 
        bgContainer.style.backgroundImage = `url(${croppedImageURL})`; 
        bgContainer.style.backgroundSize = 'cover'; 
        bgContainer.style.backgroundPosition = 'center'; 
    }

    // 🔥 สั่งบันทึกรูปลงความจำของเบราว์เซอร์
    const studentId = localStorage.getItem('sut_student_id');
    if (studentId) {
        try {
            localStorage.setItem(`sut_bg_${studentId}`, croppedImageURL);
        } catch (e) {
            console.warn('ไม่สามารถบันทึกรูปลง LocalStorage ได้ (ไฟล์อาจใหญ่เกินไป)');
        }
    }

    closeModal('crop-bg-modal');
};
window.changeProfileAvatar = function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const avatarImg = document.getElementById('profile-avatar-img');
            const defaultIcon = document.getElementById('default-avatar-icon');
            
            if (avatarImg) { 
                avatarImg.src = e.target.result; 
                avatarImg.style.display = 'block'; 
            }
            if (defaultIcon) { 
                defaultIcon.style.display = 'none'; 
            }

            // 🔥 สั่งบันทึกรูปโปรไฟล์ลงความจำเบราว์เซอร์
            const studentId = localStorage.getItem('sut_student_id');
            if (studentId) {
                try {
                    localStorage.setItem(`sut_avatar_${studentId}`, e.target.result);
                } catch (err) {
                    console.warn('ไม่สามารถบันทึกรูปลง LocalStorage ได้ (ไฟล์อาจใหญ่เกินไป)');
                }
            }
        };
        reader.readAsDataURL(file);
    }
};

// ==========================================
// ℹ️ ระบบดูข้อมูลกลุ่ม / โปรไฟล์เพื่อน
// ==========================================
window.openGroupInfo = async function() {
    if (!currentChatRoomId) return;
    const roomName = document.getElementById('current-room-title').innerText;
    const isDM = currentActualRoomName && currentActualRoomName.startsWith('DM_');

    if (isDM) {
        // --- โหมดแชทส่วนตัว (เด้งไปหน้าข้อมูลส่วนตัวของเพื่อน) ---
        const myId = localStorage.getItem('sut_student_id');
        const ids = currentActualRoomName.replace('DM_', '').split('_');
        currentFriendIdInDM = ids[0] === myId ? ids[1] : ids[0];
        
        await viewFriendProfile(currentFriendIdInDM);
        return; // สำคัญ: หยุดการทำงานตรงนี้ เพื่อไม่ให้เปิด Modal ของกลุ่มแชท
    }

    // --- โหมดกลุ่มสาธารณะ/ส่วนตัว (เปิด Modal เหมือนเดิม) ---
    document.getElementById('info-group-name').innerText = roomName;
    document.getElementById('info-group-name').style.display = 'block';
    if(document.getElementById('input-edit-group-name')) document.getElementById('input-edit-group-name').style.display = 'none';
    if(document.getElementById('btn-save-group-name')) document.getElementById('btn-save-group-name').style.display = 'none';

    document.getElementById('info-group-type').innerHTML = currentRoomIsPrivate ? '<i class="fa-solid fa-lock"></i> กลุ่มส่วนตัว' : '<i class="fa-solid fa-globe"></i> กลุ่มสาธารณะ';
    document.getElementById('default-group-icon').className = 'fa-solid fa-users';
    const isAdmin = currentRoomRole === 'admin';
    document.getElementById('btn-edit-group-name').style.display = isAdmin ? 'block' : 'none';
    if(document.getElementById('btn-edit-group-avatar')) document.getElementById('btn-edit-group-avatar').style.display = isAdmin ? 'flex' : 'none';
    document.getElementById('section-join-requests').style.display = isAdmin && currentRoomIsPrivate ? 'block' : 'none';
    document.getElementById('btn-delete-group').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('section-group-members').style.display = 'block';
    document.getElementById('btn-leave-group').style.display = 'block';
    document.getElementById('section-friend-profile').style.display = 'none';
    document.getElementById('btn-unfriend').style.display = 'none';

    await fetchGroupMembers();
    if (isAdmin && currentRoomIsPrivate) await fetchJoinRequests();
    
    openModal('modal-group-info');
};

// ==========================================
// 👤 ระบบสลับดูข้อมูลโปรไฟล์เพื่อน (Read-only)
// ==========================================
window.viewFriendProfile = async function(friendId) {
    // 1. ซ่อนทุกหน้า แล้วเปิดโชว์เฉพาะหน้า Profile
    document.querySelectorAll('.page-view').forEach(page => { page.style.display = 'none'; page.classList.remove('active'); });
    const profilePage = document.getElementById('profile') || document.querySelector('.page-view:nth-child(1)'); 
    if (profilePage) {
        profilePage.style.display = 'block';
        profilePage.classList.add('active');
    }

    // 2. เคลียร์ Active ของเมนูด้านซ้าย แล้วให้ไป Active ที่เมนูข้อมูลส่วนตัวแทน
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    const profileMenu = document.querySelectorAll('.menu-item')[0];
    if(profileMenu) profileMenu.classList.add('active');

    // 3. ปรับ Header เสกปุ่ม "กลับหน้าแชท" และซ่อนปุ่ม Save ของเดิม
    const h2Elements = profilePage.querySelectorAll('h2, .section-header');
    h2Elements.forEach(el => {
        if (el.innerText.includes('ข้อมูลส่วนตัว') || el.innerText.includes('ข้อมูลของเพื่อน')) {
            el.innerHTML = `
                <button onclick="backToChatFromProfile()" style="background: #f3f4f6; color: #4b5563; border: 1px solid #d1d5db; padding: 6px 14px; border-radius: 8px; margin-right: 15px; cursor: pointer; font-family: 'Prompt'; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; transition: 0.2s;" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='#f3f4f6'">
                    <i class="fa-solid fa-arrow-left"></i> กลับไปหน้าแชท
                </button>
                ข้อมูลของเพื่อน (${friendId})
            `;
        }
    });

    const saveBtn = document.getElementById('save-profile-btn');
    if (saveBtn) saveBtn.style.display = 'none';

    // ซ่อนปุ่มแก้ไขพื้นหลังและปุ่มแก้ไขรูปโปรไฟล์
    const editBgBtn = document.querySelector('.edit-bg-btn');
    const editAvatarBtn = document.querySelector('.edit-avatar-btn');
    if (editBgBtn) editBgBtn.style.display = 'none';
    if (editAvatarBtn) editAvatarBtn.style.display = 'none';

    // 🔥 เพิ่มตรงนี้: โหลดรูปพื้นหลังและรูปโปรไฟล์ของเพื่อนมาแสดง
    const bgContainer = document.getElementById('profile-bg-container');
    const friendBg = localStorage.getItem(`sut_bg_${friendId}`);
    if (bgContainer) {
        if (friendBg) {
            bgContainer.style.backgroundImage = `url(${friendBg})`;
        } else {
            bgContainer.style.backgroundImage = 'none'; // ถ้าเพื่อนไม่ได้ตั้งรูป ให้โชว์พื้นหลังว่างๆ
        }
    }

    const avatarImg = document.getElementById('profile-avatar-img');
    const defaultIcon = document.getElementById('default-avatar-icon');
    const friendAvatar = localStorage.getItem(`sut_avatar_${friendId}`);
    if (avatarImg && defaultIcon) {
        if (friendAvatar) {
            avatarImg.src = friendAvatar;
            avatarImg.style.display = 'block';
            defaultIcon.style.display = 'none';
        } else {
            avatarImg.style.display = 'none';
            defaultIcon.style.display = 'block';
        }
    }

    // 4. ล็อก Input ทั้งหมดไม่ให้แก้ไข และเปลี่ยนสีพื้นหลังให้ดูเป็น Read-only
    const inputs = ['profile-fullname', 'profile-faculty', 'profile-major', 'profile-age', 'profile-freetime', 'profile-mbti', 'profile-learning-style', 'profile-social'];
    
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.value = 'กำลังโหลดข้อมูล...';
            el.readOnly = true;
            el.style.backgroundColor = '#f9fafb';
            el.style.color = '#6b7280';
            el.style.cursor = 'not-allowed';
            el.style.border = '1px dashed #d1d5db';
        }
    });

    // 5. ดึงข้อมูลเพื่อนจาก Database มาใส่
    const { data, error } = await supabaseClient.from('profiles').select('*').eq('student_id', friendId).single();
    if (data) {
        const fullName = `${data.first_name || ''} ${data.last_name || ''}`.trim();
        
        // อัปเดตชื่อตัวใหญ่ใต้รูปโปรไฟล์ให้เป็นของเพื่อน
        const displayNameEl = document.getElementById('display-profile-name');
        if (displayNameEl) displayNameEl.innerText = fullName || friendId;

        if(document.getElementById('profile-fullname')) document.getElementById('profile-fullname').value = fullName || '-';
        if(document.getElementById('profile-faculty')) document.getElementById('profile-faculty').value = data.faculty || '-';
        if(document.getElementById('profile-major')) document.getElementById('profile-major').value = data.major || '-';
        if(document.getElementById('profile-age')) document.getElementById('profile-age').value = data.age || '-';
        if(document.getElementById('profile-freetime')) document.getElementById('profile-freetime').value = data.free_time || '-';
        if(document.getElementById('profile-mbti')) document.getElementById('profile-mbti').value = data.mbti || '-';
        if(document.getElementById('profile-learning-style')) document.getElementById('profile-learning-style').value = data.learning_style || '-';
        if(document.getElementById('profile-social')) document.getElementById('profile-social').value = data.social_media || '-';
    } else {
        inputs.forEach(id => { const el = document.getElementById(id); if(el) el.value = 'ไม่พบข้อมูลในระบบ'; });
        const displayNameEl = document.getElementById('display-profile-name');
        if (displayNameEl) displayNameEl.innerText = friendId;
    }
};
// ==========================================
// 🔙 ฟังก์ชันปุ่ม "กลับหน้าแชท"
// ==========================================
window.backToChatFromProfile = function() {
    // 1. คืนค่าหน้า Profile ให้เป็นข้อมูลของตัวเองเหมือนเดิม
    restoreMyProfile();

    // 2. หันเหทิศทางกลับไปที่หน้า Community Chat
    const chatMenuBtn = document.querySelectorAll('.menu-item')[2]; // สมมติว่าเมนูแชทอยู่ลำดับ 3
    if(chatMenuBtn) {
        switchPage('community-chat', chatMenuBtn);
    } else {
        switchPage('community-chat');
    }
};

// ==========================================
// ♻️ ฟังก์ชันคืนค่าหน้าโปรไฟล์กลับเป็นของตัวเอง
// ==========================================
window.restoreMyProfile = function() {
    const profilePage = document.getElementById('profile') || document.querySelector('.page-view:nth-child(1)'); 
    if (!profilePage) return;

    // 1. คืนค่าข้อความ Header และโชว์ปุ่ม Save กลับมา
    const h2Elements = profilePage.querySelectorAll('h2, .section-header');
    h2Elements.forEach(el => {
        if (el.innerText.includes('กลับไปหน้าแชท') || el.innerText.includes('ข้อมูลของเพื่อน')) {
            el.innerHTML = 'ข้อมูลส่วนตัว';
        }
    });

    const saveBtn = document.getElementById('save-profile-btn');
    if (saveBtn) saveBtn.style.display = 'block';

    // 🔥 แสดงปุ่มแก้ไขพื้นหลังและปุ่มแก้ไขรูปโปรไฟล์กลับมา (ใช้ flex ตาม CSS เดิม)
    const editBgBtn = document.querySelector('.edit-bg-btn');
    const editAvatarBtn = document.querySelector('.edit-avatar-btn');
    if (editBgBtn) editBgBtn.style.display = 'flex';
    if (editAvatarBtn) editAvatarBtn.style.display = 'flex';

    // 2. ปลดล็อก Input ทั้งหมด ให้แก้ไขได้ตามปกติ
    const inputs = ['profile-fullname', 'profile-faculty', 'profile-major', 'profile-age', 'profile-freetime', 'profile-mbti', 'profile-learning-style', 'profile-social'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.value = '';
            el.readOnly = false;
            el.style.backgroundColor = '#ffffff';
            el.style.color = '#111827';
            el.style.cursor = 'text';
            el.style.border = '1px solid #d1d5db';
        }
    });

    // 3. โหลดข้อมูลของคุณปัณณทัตกลับมาทับ (ฟังก์ชันนี้จะดึงชื่อมาใส่ใต้รูปให้อัตโนมัติด้วย)
    if (typeof fetchStudentProfileOnLogin === 'function') {
        fetchStudentProfileOnLogin();
    }
};
async function fetchFriendProfile(friendId) {
    const container = document.getElementById('friend-profile-details');
    container.innerHTML = '<div style="text-align:center; font-size:12px; color:#999;">กำลังโหลดข้อมูล...</div>';
    const { data, error } = await supabaseClient.from('profiles').select('*').eq('student_id', friendId).single();
    if (error || !data) { container.innerHTML = '<div style="color:red; font-size:12px;">ไม่สามารถโหลดข้อมูลโปรไฟล์ได้</div>'; return; }
    container.innerHTML = `
        <div style="display: flex; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;"><span style="font-size: 13px; color: #6b7280;">อายุ</span><span style="font-size: 13px; font-weight: 500; color: #111;">${data.age || '-'}</span></div>
        <div style="display: flex; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;"><span style="font-size: 13px; color: #6b7280;">MBTI</span><span style="font-size: 13px; font-weight: 500; color: #111;">${data.mbti || '-'}</span></div>
        <div style="display: flex; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;"><span style="font-size: 13px; color: #6b7280;">สไตล์การเรียน</span><span style="font-size: 13px; font-weight: 500; color: #111;">${data.learning_style || '-'}</span></div>
        <div style="display: flex; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;"><span style="font-size: 13px; color: #6b7280;">เวลาว่าง</span><span style="font-size: 13px; font-weight: 500; color: #111;">${data.free_time || '-'}</span></div>
        <div style="display: flex; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;"><span style="font-size: 13px; color: #6b7280;">Social Media</span><span style="font-size: 13px; font-weight: 500; color: #111;">${data.social_media || '-'}</span></div>
    `;
}

window.unfriendUser = async function() {
    if(!confirm("คุณต้องการลบเพื่อนคนนี้ใช่หรือไม่?")) return;
    const myId = localStorage.getItem('sut_student_id');
    try {
        await supabaseClient.from('friendships').delete().or(`and(requester_id.eq.${myId},receiver_id.eq.${currentFriendIdInDM}),and(requester_id.eq.${currentFriendIdInDM},receiver_id.eq.${myId})`);
        await supabaseClient.from('chat_room_members').delete().eq('room_id', currentChatRoomId).eq('student_id', myId);
        closeModal('modal-group-info');
        document.querySelector('.chat-history').innerHTML = `<div style="text-align:center; color:#999; margin-top:50px;">เลือกแชทด้านซ้ายเพื่อเริ่มพูดคุย</div>`;
        document.getElementById('current-room-title').innerText = "ยังไม่ได้เลือกกลุ่ม";
        document.getElementById('btn-group-info').style.display = 'none';
        await loadChatRooms(); 
        showSuccessModal('สำเร็จ', "ลบเพื่อนเรียบร้อยแล้ว");
    } catch (err) { alert("เกิดข้อผิดพลาด: " + err.message); }
};

async function fetchGroupMembers() {
    const listContainer = document.getElementById('list-group-members');
    listContainer.innerHTML = '<div style="text-align:center; font-size:12px; color:#999;">กำลังโหลด...</div>';
    try {
        const { data: members, error: memberError } = await supabaseClient.from('chat_room_members').select('role, student_id').eq('room_id', currentChatRoomId).eq('status', 'joined').order('role', { ascending: true });
        if (memberError) throw memberError;
        if (!members || members.length === 0) { document.getElementById('badge-member-count').innerText = `(0)`; listContainer.innerHTML = '<div style="font-size:12px; color:#999;">ไม่มีสมาชิก</div>'; return; }
        document.getElementById('badge-member-count').innerText = `(${members.length})`;

        const studentIds = members.map(m => m.student_id);
        const { data: profiles } = await supabaseClient.from('profiles').select('student_id, first_name, last_name').in('student_id', studentIds);
        const profileMap = {};
        if (profiles) profiles.forEach(p => { profileMap[p.student_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });

        listContainer.innerHTML = '';
        members.forEach(m => {
            const name = profileMap[m.student_id] || 'ไม่ระบุชื่อ';
            const isAdmin = m.role === 'admin';
            const roleBadge = isAdmin ? `<span style="background:#fef08a; color:#854d0e; font-size:10px; padding:2px 6px; border-radius:10px; margin-left:8px;">Admin</span>` : '';
            listContainer.innerHTML += `
                <div style="display: flex; align-items: center; gap: 12px; padding: 8px 0;">
                    <div style="width: 36px; height: 36px; background: #e5e7eb; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #6b7280; font-weight: bold; font-size: 14px;">${m.student_id.substring(0, 1)}</div>
                    <div><div style="font-size: 14px; font-weight: 500; color: #111;">${m.student_id} ${roleBadge}</div><div style="font-size: 12px; color: #6b7280;">${name}</div></div>
                </div>
            `;
        });
    } catch (error) { listContainer.innerHTML = `<div style="color:red; font-size:12px;">เกิดข้อผิดพลาด: ${error.message}</div>`; }
}

window.enableEditGroupName = function() {
    const nameText = document.getElementById('info-group-name');
    const nameInput = document.getElementById('input-edit-group-name');
    const editBtn = document.getElementById('btn-edit-group-name');
    const saveBtn = document.getElementById('btn-save-group-name');
    nameInput.value = nameText.innerText;
    nameText.style.display = 'none';
    nameInput.style.display = 'block';
    nameInput.focus();
    editBtn.style.display = 'none';
    saveBtn.style.display = 'block';
};

window.saveGroupName = async function() {
    if (!currentChatRoomId) return;
    const nameText = document.getElementById('info-group-name');
    const nameInput = document.getElementById('input-edit-group-name');
    const editBtn = document.getElementById('btn-edit-group-name');
    const saveBtn = document.getElementById('btn-save-group-name');
    const newName = nameInput.value.trim();
    const currentName = nameText.innerText;

    if (newName === "" || newName === currentName) {
        nameText.style.display = 'block'; nameInput.style.display = 'none'; editBtn.style.display = 'block'; saveBtn.style.display = 'none'; return;
    }

    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';
    saveBtn.disabled = true;

    try {
        const { error } = await supabaseClient.from('chat_rooms').update({ name: newName }).eq('id', currentChatRoomId);
        if (error) throw error;
        nameText.innerText = newName;
        document.getElementById('current-room-title').innerText = newName;
        nameText.style.display = 'block'; nameInput.style.display = 'none'; editBtn.style.display = 'block'; saveBtn.style.display = 'none';
        await loadChatRooms(); 
    } catch (error) { alert("เกิดข้อผิดพลาด: " + error.message); } 
    finally { saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> บันทึกชื่อ'; saveBtn.disabled = false; }
};

async function fetchJoinRequests() {
    const listContainer = document.getElementById('list-join-requests');
    const { data: requests } = await supabaseClient.from('chat_room_members').select(`student_id`).eq('room_id', currentChatRoomId).eq('status', 'pending');
    document.getElementById('badge-request-count').innerText = requests ? requests.length : 0;
    listContainer.innerHTML = '';
    if (!requests || requests.length === 0) { listContainer.innerHTML = '<div style="font-size:12px; color:#9ca3af;">ไม่มีคำขอใหม่</div>'; return; }
    requests.forEach(req => {
        listContainer.innerHTML += `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
                <div style="font-size: 14px; font-weight: 500;">${req.student_id}</div>
                <div style="display: flex; gap: 5px;">
                    <button onclick="handleJoinRequest('${req.student_id}', 'joined')" style="background:#10b981; color:white; border:none; padding:4px 10px; border-radius:4px; font-size:12px; cursor:pointer;">รับ</button>
                    <button onclick="handleJoinRequest('${req.student_id}', 'rejected')" style="background:#ef4444; color:white; border:none; padding:4px 10px; border-radius:4px; font-size:12px; cursor:pointer;">ปฎิเสธ</button>
                </div>
            </div>
        `;
    });
}

window.handleJoinRequest = async function(targetId, newStatus) {
    if (newStatus === 'rejected') await supabaseClient.from('chat_room_members').delete().eq('room_id', currentChatRoomId).eq('student_id', targetId);
    else await supabaseClient.from('chat_room_members').update({ status: 'joined' }).eq('room_id', currentChatRoomId).eq('student_id', targetId);
    fetchJoinRequests(); 
    fetchGroupMembers(); 
};

window.leaveCurrentGroup = async function() {
    if(!confirm("คุณต้องการออกจากกลุ่มนี้ใช่หรือไม่?")) return;
    const myId = localStorage.getItem('sut_student_id');
    await supabaseClient.from('chat_room_members').delete().eq('room_id', currentChatRoomId).eq('student_id', myId);
    closeModal('modal-group-info');
    document.querySelector('.chat-history').innerHTML = `<div style="text-align:center; color:#999; margin-top:50px;">เลือกกลุ่มแชทด้านซ้ายเพื่อเริ่มพูดคุย</div>`;
    document.getElementById('current-room-title').innerText = "ยังไม่ได้เลือกกลุ่ม";
    document.getElementById('btn-group-info').style.display = 'none';
    loadChatRooms(); 
};

async function loadFriendsData() {
    const myId = localStorage.getItem('sut_student_id');
    const friendsContainer = document.getElementById('friends-list');
    const reqContainer = document.getElementById('friend-requests-list');
    const reqSection = document.getElementById('friend-requests-section');
    if (!myId || !friendsContainer || !reqContainer || !reqSection) return;

    try {
        const { data: pendingReqs } = await supabaseClient.from('friendships').select('*').eq('receiver_id', myId).eq('status', 'pending');
        const { data: acceptedFriends } = await supabaseClient.from('friendships').select('*').or(`requester_id.eq.${myId},receiver_id.eq.${myId}`).eq('status', 'accepted');

        let targetIds = [];
        if (pendingReqs) pendingReqs.forEach(r => targetIds.push(r.requester_id));
        if (acceptedFriends) acceptedFriends.forEach(r => { targetIds.push(r.requester_id === myId ? r.receiver_id : r.requester_id); });
        targetIds = [...new Set(targetIds)];

        let profileMap = {};
        if (targetIds.length > 0) {
            const { data: profiles } = await supabaseClient.from('profiles').select('student_id, first_name, last_name').in('student_id', targetIds);
            if (profiles) profiles.forEach(p => { profileMap[p.student_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });
        }

        if (pendingReqs && pendingReqs.length > 0) {
            reqSection.style.display = 'block';
            document.getElementById('friend-request-count').innerText = pendingReqs.length;
            reqContainer.innerHTML = '';
            pendingReqs.forEach(req => {
                const name = profileMap[req.requester_id] || 'ไม่ระบุชื่อ';
                reqContainer.innerHTML += `
                    <div style="background: white; border: 1px solid #e5e7eb; padding: 10px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                        <div style="font-weight: 600; font-size: 13px; color: #111;">${req.requester_id}</div>
                        <div style="font-size: 11px; color: #6b7280; margin-bottom: 8px;">${name}</div>
                        <div style="display: flex; gap: 5px;">
                            <button onclick="handleFriendRequest('${req.requester_id}', 'accepted')" style="flex: 1; background: #10b981; color: white; border: none; padding: 6px; border-radius: 6px; font-size: 12px; cursor: pointer;">รับแอด</button>
                            <button onclick="handleFriendRequest('${req.requester_id}', 'rejected')" style="flex: 1; background: #f3f4f6; color: #4b5563; border: none; padding: 6px; border-radius: 6px; font-size: 12px; cursor: pointer;">ลบ</button>
                        </div>
                    </div>`;
            });
        } else { reqSection.style.display = 'none'; }

        document.getElementById('friends-count').innerText = `(${acceptedFriends ? acceptedFriends.length : 0})`;
        friendsContainer.innerHTML = '';
        if (!acceptedFriends || acceptedFriends.length === 0) { friendsContainer.innerHTML = '<div style="text-align: center; font-size: 12px; color: #9ca3af; padding: 20px;">ยังไม่มีเพื่อนในระบบ</div>'; } 
        else {
            acceptedFriends.forEach(f => {
                const friendId = f.requester_id === myId ? f.receiver_id : f.requester_id;
                const name = profileMap[friendId] || 'ไม่ระบุชื่อ';
                friendsContainer.innerHTML += `
                    <div onclick="openDirectMessage('${friendId}', '${name}')" style="display: flex; align-items: center; gap: 10px; padding: 10px; background: white; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer;">
                        <div style="width: 35px; height: 35px; background: #dbeafe; color: #2563eb; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">${friendId.substring(0, 1)}</div>
                        <div style="flex: 1; overflow: hidden;">
                            <div style="font-size: 13px; font-weight: 600; color: #111;">${friendId}</div>
                            <div style="font-size: 11px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</div>
                        </div>
                        <i class="fa-solid fa-comment-dots" style="color: #cbd5e1; font-size: 16px;"></i>
                    </div>`;
            });
        }
    } catch (err) { console.error('Error loading friends:', err); }
}

window.openDirectMessage = async function(friendId, friendName) {
    const myId = localStorage.getItem('sut_student_id');
    if (!myId) return;
    const ids = [myId, friendId].sort();
    const dmRoomName = `DM_${ids[0]}_${ids[1]}`;
    const displayRoomName = `${friendName} (${friendId})`; 
    try {
        const { data: existingRooms, error: searchError } = await supabaseClient.from('chat_rooms').select('id').eq('name', dmRoomName).eq('is_private', true);
        if (searchError) throw searchError;

        let roomId;
        if (existingRooms && existingRooms.length > 0) { roomId = existingRooms[0].id; } 
        else {
            const { data: newRoom, error: createError } = await supabaseClient.from('chat_rooms').insert([{ name: dmRoomName, is_private: true }]).select().single();
            if (createError) throw createError;
            roomId = newRoom.id;
            const membersToInsert = [{ room_id: roomId, student_id: myId, role: 'member', status: 'joined' }, { room_id: roomId, student_id: friendId, role: 'member', status: 'joined' }];
            const { error: memberError } = await supabaseClient.from('chat_room_members').insert(membersToInsert);
            if (memberError) throw memberError;
        }
        await selectChatRoom(roomId, displayRoomName);
    } catch (error) { alert("ไม่สามารถสร้างห้องแชทได้: " + error.message); }
};

// ==========================================
// 🔘 ระบบแชทหน้าต่าง (ลากย้าย + ยืดหด 8 ทิศทาง)
// ==========================================
window.toggleChatExpand = function() {
    const chatSection = document.querySelector('.ai-chat-section');
    const expandIcon = document.querySelector('#btn-expand-chat i');
    if(!chatSection) return;

    chatSection.classList.toggle('expanded');
    
    if (chatSection.classList.contains('expanded')) {
        expandIcon.classList.replace('fa-expand', 'fa-compress');
        
        // 🔥 เซ็ตขนาดเริ่มต้นให้อยู่กลางจอ (ปรับได้ตามชอบ)
        chatSection.style.width = '70vw';
        chatSection.style.height = '80vh';
        chatSection.style.top = '10vh';
        chatSection.style.left = '15vw';
        chatSection.style.right = 'auto';
        chatSection.style.bottom = 'auto';
    } else {
        expandIcon.classList.replace('fa-compress', 'fa-expand');
        
        // คืนค่ากลับไปอยู่ตำแหน่งเดิม
        chatSection.style.width = '';
        chatSection.style.height = '';
        chatSection.style.top = '';
        chatSection.style.left = '';
    }
};

function setupDraggableChatWindow() {
    const chatBox = document.querySelector('.ai-chat-section');
    const header = chatBox ? chatBox.querySelector('div:first-child') : null; 
    if(!chatBox || !header) return;

    // ป้องกันการสร้าง Resizer ซ้ำถ้ากดรีเฟรช
    if (chatBox.querySelector('.chat-resizer')) return;

    // 1. ระบบจับลากย้ายหน้าต่าง (Drag)
    header.style.cursor = 'move';
    header.addEventListener('mousedown', function(e) {
        if(!chatBox.classList.contains('expanded')) return;
        if(e.target.closest('button')) return; // ถอยถ้าผู้ใช้กำลังกดปุ่มย่อ/ขยาย
        
        e.preventDefault();
        let startX = e.clientX, startY = e.clientY;
        let rect = chatBox.getBoundingClientRect();
        let startL = rect.left, startT = rect.top;
        
        function doMove(e) {
            chatBox.style.left = startL + (e.clientX - startX) + 'px';
            chatBox.style.top = startT + (e.clientY - startY) + 'px';
        }
        function stopMove() {
            document.removeEventListener('mousemove', doMove);
            document.removeEventListener('mouseup', stopMove);
        }
        document.addEventListener('mousemove', doMove);
        document.addEventListener('mouseup', stopMove);
    });

    // 2. ระบบยืดหด 8 ทิศทาง (Resize)
    const directions = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    directions.forEach(dir => {
        const handle = document.createElement('div');
        handle.className = `chat-resizer resizer-${dir}`;
        chatBox.appendChild(handle);
        
        handle.addEventListener('mousedown', function(e) {
            if(!chatBox.classList.contains('expanded')) return;
            e.preventDefault();
            e.stopPropagation(); // สำคัญมาก: ป้องกันไม่ให้ไปชนกับ Event อื่น
            
            let startX = e.clientX, startY = e.clientY;
            let rect = chatBox.getBoundingClientRect();
            let startW = rect.width, startH = rect.height;
            let startL = rect.left, startT = rect.top;

            function doResize(e) {
                let newW = startW, newH = startH, newL = startL, newT = startT;

                // คำนวณฝั่งขวา-ซ้าย
                if (dir.includes('e')) newW = startW + (e.clientX - startX);
                if (dir.includes('w')) {
                    newW = startW - (e.clientX - startX);
                    newL = startL + (e.clientX - startX);
                }
                
                // คำนวณฝั่งบน-ล่าง
                if (dir.includes('s')) newH = startH + (e.clientY - startY);
                if (dir.includes('n')) {
                    newH = startH - (e.clientY - startY);
                    newT = startT + (e.clientY - startY);
                }

                // ล็อคขนาดเล็กสุดไม่ให้หดจนแชทพัง
                if (newW > 350) { 
                    chatBox.style.width = newW + 'px'; 
                    chatBox.style.left = newL + 'px'; 
                }
                if (newH > 400) { 
                    chatBox.style.height = newH + 'px'; 
                    chatBox.style.top = newT + 'px'; 
                }
            }
            
            function stopResize() {
                document.removeEventListener('mousemove', doResize);
                document.removeEventListener('mouseup', stopResize);
            }
            
            document.addEventListener('mousemove', doResize);
            document.addEventListener('mouseup', stopResize);
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(setupDraggableChatWindow, 500);
});

// ==========================================
// 🔗 ระบบแชร์ตารางเรียนลงแชท & ดึงตารางเรียนจากเพื่อน
// ==========================================

// ==========================================
// 🔗 ระบบแชร์ตารางเรียนลงแชท (UI Pop-up ให้เลือก ปี/เทอม)
// ==========================================

// 1. ฟังก์ชันเปิดหน้าต่าง Pop-up เลือกปีและเทอมที่จะแชร์
window.shareMyScheduleToChat = function() {
    if (!currentChatRoomId) return alert("⚠️ กรุณาเลือกห้องแชทเพื่อนก่อนครับ");
    
    // ตรวจสอบและสร้าง UI Modal ขึ้นมาถ้ายังไม่มี
    createShareModalIfNotExist();
    
    // ตั้งค่าตัวเลือกเริ่มต้นให้ตรงกับหน้าตารางที่เปิดอยู่ปัจจุบัน
    document.getElementById('share-target-year').value = currentYearLevel;
    document.getElementById('share-target-sem').value = currentSemester;
    
    // เปิดหน้าต่าง Pop-up
    openModal('modal-share-schedule-select');
};

// 2. ฟังก์ชันยืนยันดึงข้อมูลตารางและแชร์ลงแชท (ทำงานเมื่อกดปุ่ม "แชร์เลย")
window.executeShareSchedule = async function() {
    const btn = document.getElementById('btn-confirm-share');
    const originalText = btn.innerHTML;
    
    const targetYear = parseInt(document.getElementById('share-target-year').value);
    const targetSem = parseInt(document.getElementById('share-target-sem').value);
    const targetKey = `${targetYear}_${targetSem}`;
    
    let dataToShare = [];
    
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเตรียมข้อมูล...';
    btn.disabled = true;

    try {
        // เช็คว่าผู้ใช้เลือกแชร์เทอมที่เปิดอยู่บนหน้าจอตอนนี้หรือไม่
        if (targetYear === currentYearLevel && targetSem === currentSemester) {
            dataToShare = JSON.parse(JSON.stringify(selectedCoursesData));
        } 
        // ถ้าแชร์เทอมอื่น ให้ลองหาข้อมูลจากความจำ (Cache) ของเว็บก่อน
        else if (scheduleCache[targetKey] && scheduleCache[targetKey].data.length > 0) {
            dataToShare = JSON.parse(JSON.stringify(scheduleCache[targetKey].data));
        } 
        // หากไม่มีในความจำ ให้ดิ่งไปดึงจากฐานข้อมูล Supabase สดๆ
        else {
            const studentId = localStorage.getItem('sut_student_id');
            const { data, error } = await supabaseClient
                .from('user_schedules')
                .select('course_ids')
                .eq('student_id', studentId)
                .eq('year_level', targetYear)
                .eq('semester', targetSem)
                .maybeSingle();
                
            if (error) throw error;
            if (data && data.course_ids && data.course_ids.length > 0) {
                dataToShare = data.course_ids;
                // เก็บใส่ความจำไว้ด้วยเผื่อใช้รอบหน้า
                scheduleCache[targetKey] = {
                    ids: dataToShare.map(c => c.id),
                    data: JSON.parse(JSON.stringify(dataToShare))
                };
            }
        }

        // ถ้าดึงมาแล้วพบว่าตารางว่างเปล่า ให้แจ้งเตือนและหยุดการแชร์
        if (!dataToShare || dataToShare.length === 0) {
            alert(`⚠️ คุณยังไม่มีวิชาเรียนในตาราง ปี ${targetYear} เทอม ${targetSem} ครับ\nกรุณาจัดตารางเรียนก่อนนำมาแชร์นะครับ`);
            btn.innerHTML = originalText;
            btn.disabled = false;
            return;
        }

        // แพ็กข้อมูลใส่กล่องแล้วส่งเข้าห้องแชท
        const studentId = localStorage.getItem('sut_student_id');
        const payload = {
            year: targetYear,
            sem: targetSem,
            courses: dataToShare
        };
        const msgString = "SYS_SHARE:" + JSON.stringify(payload);

        await supabaseClient.from('chat_messages').insert([
            { room_id: currentChatRoomId, sender_id: studentId, message: msgString }
        ]);

        closeModal('modal-share-schedule-select');

    } catch (error) {
        console.error("Share Error:", error);
        alert("❌ เกิดข้อผิดพลาดในการแชร์ตาราง: " + error.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// 3. ตัวช่วยสร้าง UI Pop-up หน้าเลือกแชร์ตารางฝังลงในเว็บ
function createShareModalIfNotExist() {
    if (document.getElementById('modal-share-schedule-select')) return;
    const modalHtml = `
        <div id="modal-share-schedule-select" class="chat-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; align-items: center; justify-content: center; backdrop-filter: blur(3px);">
            <div class="modal-content" style="background: white; width: 95%; max-width: 450px; border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.3); animation: fadeIn 0.3s ease;">
                <div style="padding: 20px 25px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
                    <h3 style="margin: 0; color: #111827; font-size: 20px; display: flex; align-items: center; gap: 10px;"><i class="fa-solid fa-share-nodes" style="color: #F05A28; font-size: 24px;"></i> แชร์ตารางเรียนให้เพื่อน</h3>
                    <span class="close-modal" onclick="closeModal('modal-share-schedule-select')" style="cursor: pointer; font-size: 28px; color: #9ca3af; line-height: 1; padding: 0 5px;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#9ca3af'">&times;</span>
                </div>
                <div style="padding: 25px; background: #f9fafb;">
                    <p style="margin-top: 0; margin-bottom: 20px; font-size: 14px; color: #4b5563;">กรุณาเลือกปีการศึกษาและเทอมของตารางเรียนที่คุณต้องการแชร์ลงในห้องแชทนี้ครับ</p>
                    
                    <div style="display: flex; gap: 15px; margin-bottom: 25px;">
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 13px; font-weight: 600; color: #1f2937; margin-bottom: 8px;">ชั้นปี</label>
                            <select id="share-target-year" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #d1d5db; background: white; font-family: 'Prompt'; font-size: 15px; color: #1f2937; cursor: pointer; outline: none;">
                                <option value="1">ปี 1</option>
                                <option value="2">ปี 2</option>
                                <option value="3">ปี 3</option>
                                <option value="4">ปี 4</option>
                            </select>
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 13px; font-weight: 600; color: #1f2937; margin-bottom: 8px;">เทอม</label>
                            <select id="share-target-sem" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #d1d5db; background: white; font-family: 'Prompt'; font-size: 15px; color: #1f2937; cursor: pointer; outline: none;">
                                <option value="1">เทอม 1</option>
                                <option value="2">เทอม 2</option>
                                <option value="3">เทอม 3</option>
                            </select>
                        </div>
                    </div>

                    <div style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button onclick="closeModal('modal-share-schedule-select')" style="padding: 12px 20px; border-radius: 10px; border: 1px solid #d1d5db; background: white; color: #4b5563; cursor: pointer; font-family: 'Prompt'; font-weight: 500; font-size: 15px; transition: 0.2s;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">ยกเลิก</button>
                        <button id="btn-confirm-share" onclick="executeShareSchedule()" style="padding: 12px 24px; border-radius: 10px; border: none; background: #F05A28; color: white; cursor: pointer; font-family: 'Prompt'; font-weight: 600; font-size: 15px; transition: 0.2s; box-shadow: 0 4px 6px rgba(240, 90, 40, 0.2);" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 12px rgba(240, 90, 40, 0.3)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px rgba(240, 90, 40, 0.2)';"><i class="fa-solid fa-paper-plane"></i> แชร์เลย</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}
// ==========================================
// 📥 ระบบพรีวิวและนำเข้าตารางเรียนจากเพื่อน (UI อัปเกรดใหม่)
// ==========================================

let pendingImportCourses = []; // ตัวแปรเก็บข้อมูลตารางเพื่อนชั่วคราวรอผู้ใช้กดยืนยัน

// 1. ฟังก์ชันเปิดหน้าต่างพรีวิวเมื่อกด "เช็คข้อมูลตาราง / ดึงตาราง"
window.importSharedSchedule = function(jsonStr, year, sem) {
    try {
        const decodedJson = jsonStr.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        pendingImportCourses = JSON.parse(decodedJson);

        if (!pendingImportCourses || pendingImportCourses.length === 0) return alert('ตารางเรียนนี้ว่างเปล่าครับ');

        // ตรวจสอบและสร้าง UI Modal ขึ้นมาถ้ายังไม่มี
        createPreviewModalIfNotExist();

        // นำรายวิชาของเพื่อนมาแสดงในรายการพรีวิว
        const listContainer = document.getElementById('preview-schedule-list');
        listContainer.innerHTML = '';
        pendingImportCourses.forEach(c => {
            const timeStr = c.no_time ? 'ไม่มีข้อมูลเวลาเรียน' : `${c.day} ${c.start}.00-${c.end}.00 น.`;
            const iconColor = c.no_time ? '#9ca3af' : '#F05A28';
            listContainer.innerHTML += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border-bottom: 1px solid #f3f4f6; font-size: 13px; transition: background 0.2s;" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='transparent'">
                    <div>
                        <strong style="color: #1f2937; font-size: 14px;">${window.formatCourseCodeDisplay(c.code)}</strong><br>
                        <span style="color: #6b7280; font-size: 12px;">${c.name}</span>
                    </div>
                    <div style="color: ${iconColor}; text-align: right; background: ${c.no_time ? '#f3f4f6' : '#fff7ed'}; padding: 6px 10px; border-radius: 8px;">
                        <i class="fa-regular fa-clock"></i> ${timeStr}
                    </div>
                </div>
            `;
        });

        // ตั้งค่าตัวเลือก ปี/เทอม ให้ตรงกับที่เพื่อนส่งมาเป็นค่าเริ่มต้น
        document.getElementById('import-target-year').value = year || 1;
        document.getElementById('import-target-sem').value = sem || 1;

        // แสดงหน้าต่าง Pop-up
        openModal('modal-preview-schedule');

    } catch(e) {
        console.error("Import error:", e);
        alert('เกิดข้อผิดพลาดในการอ่านข้อมูลตารางเรียนครับ');
    }
};

// 2. ฟังก์ชันยืนยันบันทึกวิชาลงตาราง (ทำงานเมื่อกดปุ่มเขียวใน Pop-up)
window.executeImportSharedSchedule = function() {
    const targetYear = parseInt(document.getElementById('import-target-year').value);
    const targetSem = parseInt(document.getElementById('import-target-sem').value);
    const targetKey = `${targetYear}_${targetSem}`;

    let targetIds = [];
    let targetData = [];
    let isActiveTerm = (targetYear === currentYearLevel && targetSem === currentSemester);

    // ตรวจสอบว่าผู้ใช้เลือกลงเทอมปัจจุบัน หรือเลือกลงเทอมอื่น (เซฟลง Cache)
    if (isActiveTerm) {
        targetIds = selectedCourseIds;
        targetData = selectedCoursesData;
    } else {
        if (!scheduleCache[targetKey]) scheduleCache[targetKey] = { ids: [], data: [] };
        targetIds = scheduleCache[targetKey].ids;
        targetData = scheduleCache[targetKey].data;
    }

    let added = 0;
    let skipped = 0;

    // ระบบช่วยกรองวิชาซ้ำและเวลาชน
    pendingImportCourses.forEach(sharedCourse => {
        const baseCode = sharedCourse.code.split(' (')[0];
        const isExist = targetData.some(c => c.code.split(' (')[0] === baseCode);
        
        if (!isExist) {
            let isOverlap = false;
            if (!sharedCourse.no_time && sharedCourse.day !== '-' && sharedCourse.start > 0) {
                for (let existingCourse of targetData) {
                    if (existingCourse.day === sharedCourse.day && !existingCourse.no_time) {
                        if (sharedCourse.start < existingCourse.end && sharedCourse.end > existingCourse.start) {
                            isOverlap = true; break;
                        }
                    }
                }
            }

            if (!isOverlap) {
                const newId = `FRIEND_${baseCode}_${Date.now()}_${Math.floor(Math.random()*1000)}`;
                targetData.push({ ...sharedCourse, id: newId });
                targetIds.push(newId);
                added++;
            } else {
                skipped++;
            }
        } else {
            skipped++;
        }
    });

    // อัปเดตตารางหน้าจอทันที หากนำเข้าใส่เทอมปัจจุบัน
    if (isActiveTerm && added > 0) {
        updateDatabaseTimetableAndCredits();
    }

    closeModal('modal-preview-schedule');

    // แจ้งเตือนผลลัพธ์การดึงข้อมูล
    if (added > 0) {
        showSuccessModal('นำเข้าตารางสำเร็จ!', `ดึง ${added} รายวิชาลงตาราง ปี ${targetYear} เทอม ${targetSem} เรียบร้อยแล้ว\n(ระบบช่วยกรองออก ${skipped} วิชาเนื่องจากซ้ำหรือเวลาชน)`);
    } else {
        alert(`❌ ไม่มีวิชาถูกนำเข้า\n(วิชาทั้งหมดในตารางนี้ คุณมีอยู่แล้วหรือเวลาเรียนชนกันครับ)`);
    }
};

// 3. ตัวช่วยสร้าง UI Pop-up ฝังลงในเว็บแบบอัตโนมัติ
function createPreviewModalIfNotExist() {
    if (document.getElementById('modal-preview-schedule')) return;
    const modalHtml = `
        <div id="modal-preview-schedule" class="chat-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; align-items: center; justify-content: center; backdrop-filter: blur(3px);">
            <div class="modal-content" style="background: white; width: 95%; max-width: 550px; border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.3); animation: fadeIn 0.3s ease;">
                <div style="padding: 20px 25px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
                    <h3 style="margin: 0; color: #111827; font-size: 20px; display: flex; align-items: center; gap: 10px;"><i class="fa-solid fa-calendar-check" style="color: #F05A28; font-size: 24px;"></i> พรีวิวตารางเรียน</h3>
                    <span class="close-modal" onclick="closeModal('modal-preview-schedule')" style="cursor: pointer; font-size: 28px; color: #9ca3af; line-height: 1; padding: 0 5px;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#9ca3af'">&times;</span>
                </div>
                <div style="padding: 25px; background: #f9fafb;">
                    <p style="margin-top: 0; margin-bottom: 12px; font-size: 14px; font-weight: 600; color: #4b5563;">รายการวิชาที่มากับตารางนี้:</p>
                    <div id="preview-schedule-list" style="max-height: 250px; overflow-y: auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; margin-bottom: 25px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
                        <!-- รายวิชาจะถูกแทรกตรงนี้ -->
                    </div>
                    
                    <div style="display: flex; gap: 15px; margin-bottom: 25px; background: #fff7ed; padding: 18px; border-radius: 12px; border: 1px solid #fed7aa;">
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 13px; font-weight: 600; color: #c2410c; margin-bottom: 8px;"><i class="fa-solid fa-user-graduate"></i> เลือกลงชั้นปีที่</label>
                            <select id="import-target-year" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #fdba74; background: white; font-family: 'Prompt'; font-size: 15px; color: #1f2937; cursor: pointer; outline: none;">
                                <option value="1">ปี 1</option>
                                <option value="2">ปี 2</option>
                                <option value="3">ปี 3</option>
                                <option value="4">ปี 4</option>
                            </select>
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 13px; font-weight: 600; color: #c2410c; margin-bottom: 8px;"><i class="fa-solid fa-book-open"></i> เลือกลงเทอมที่</label>
                            <select id="import-target-sem" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #fdba74; background: white; font-family: 'Prompt'; font-size: 15px; color: #1f2937; cursor: pointer; outline: none;">
                                <option value="1">เทอม 1</option>
                                <option value="2">เทอม 2</option>
                                <option value="3">เทอม 3</option>
                            </select>
                        </div>
                    </div>

                    <div style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button onclick="closeModal('modal-preview-schedule')" style="padding: 12px 20px; border-radius: 10px; border: 1px solid #d1d5db; background: white; color: #4b5563; cursor: pointer; font-family: 'Prompt'; font-weight: 500; font-size: 15px; transition: 0.2s;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">ยกเลิก</button>
                        <button onclick="executeImportSharedSchedule()" style="padding: 12px 24px; border-radius: 10px; border: none; background: #10b981; color: white; cursor: pointer; font-family: 'Prompt'; font-weight: 600; font-size: 15px; transition: 0.2s; box-shadow: 0 4px 6px rgba(16, 185, 129, 0.2);" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 12px rgba(16, 185, 129, 0.3)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px rgba(16, 185, 129, 0.2)';"><i class="fa-solid fa-download"></i> บันทึกลงตารางนี้</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// 3. เสกปุ่ม "แชร์ตาราง" ไปไว้ข้างๆ ช่องพิมพ์แชทอัตโนมัติ
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const chatInput = document.getElementById('community-msg-input');
        if (chatInput && chatInput.parentElement && !document.getElementById('btn-share-schedule')) {
            const wrapper = chatInput.parentElement;
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.gap = '10px';
            
            const shareBtn = document.createElement('button');
            shareBtn.id = 'btn-share-schedule';
            shareBtn.innerHTML = '<i class="fa-solid fa-calendar-plus"></i>';
            shareBtn.title = 'แชร์ตารางเรียนให้เพื่อน';
            shareBtn.style.cssText = 'background: #10b981; color: white; border: none; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; cursor: pointer; flex-shrink: 0; transition: 0.2s; box-shadow: 0 2px 5px rgba(0,0,0,0.1);';
            
            shareBtn.onmouseover = () => shareBtn.style.transform = 'scale(1.1)';
            shareBtn.onmouseout = () => shareBtn.style.transform = 'scale(1)';
            shareBtn.onclick = window.shareMyScheduleToChat;
            
            wrapper.insertBefore(shareBtn, chatInput);
        }
    }, 1500); // ดีเลย์นิดนึงรอให้ HTML โหลดเสร็จก่อน
});

// ==========================================
// 🚨 ระบบแจ้งเตือนปัญหา (Warning Modal) & สไลด์ไปดูตาราง
// ==========================================

window.showWarningModal = function(title, descHTML) {
    if (!document.getElementById('modal-warning-alert')) {
        const html = `
        <div id="modal-warning-alert" class="chat-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; align-items: center; justify-content: center; backdrop-filter: blur(3px);">
            <div style="background: white; width: 90%; max-width: 420px; border-radius: 16px; padding: 30px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.2); animation: fadeIn 0.3s ease;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 55px; color: #F05A28; margin-bottom: 15px;"></i>
                <h3 id="warning-alert-title" style="margin: 0 0 15px 0; color: #1f2937; font-size: 20px; font-weight: 600;">แจ้งเตือน</h3>
                <div id="warning-alert-desc" style="color: #4b5563; font-size: 14px; margin-bottom: 25px; line-height: 1.6; text-align: left; background: #fff7ed; padding: 15px; border-radius: 10px; border: 1px solid #fed7aa; max-height: 150px; overflow-y: auto;"></div>
                <div style="display: flex; gap: 10px;">
                    <button onclick="document.getElementById('modal-warning-alert').style.display='none'" style="flex: 1; background: #f3f4f6; color: #4b5563; border: none; padding: 12px; border-radius: 10px; font-weight: 600; cursor: pointer; font-family: 'Prompt'; transition: 0.2s;">ปิด</button>
                    <button onclick="closeWarningAndScrollToTable()" style="flex: 2; background: #F05A28; color: white; border: none; padding: 12px; border-radius: 10px; font-weight: 600; cursor: pointer; font-family: 'Prompt'; transition: 0.2s; box-shadow: 0 4px 6px rgba(240, 90, 40, 0.2);"><i class="fa-solid fa-magnifying-glass"></i> ดูจุดที่เวลาชน</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    }
    document.getElementById('warning-alert-title').innerText = title;
    document.getElementById('warning-alert-desc').innerHTML = descHTML;
    document.getElementById('modal-warning-alert').style.display = 'flex';
};

window.closeWarningAndScrollToTable = function() {
    document.getElementById('modal-warning-alert').style.display = 'none';
    const grid = document.getElementById('timetable-grid');
    if (grid) {
        // เลื่อนหน้าจอไปที่ตารางเรียนอย่างนุ่มนวล
        grid.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // ทำให้ขอบตารางกระพริบสีส้มเพื่อให้รู้ว่าต้องดูตรงนี้
        grid.style.transition = 'box-shadow 0.4s ease';
        grid.style.boxShadow = '0 0 30px rgba(240, 90, 40, 0.6)';
        setTimeout(() => { grid.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'; }, 2000);
    }
};

// ==========================================
// 🗑️ ฟังก์ชันรีเซ็ตตารางเรียน
// ==========================================
// ==========================================
// 🗑️ ฟังก์ชันล้างตารางเรียน (ใช้ Modal สวยงาม)
// ==========================================
window.resetTimetable = function() {
    showConfirmModal(
        'ยืนยันการล้างตาราง', 
        `คุณแน่ใจหรือไม่ว่าต้องการล้างวิชาทั้งหมดในตารางเทอมนี้?<br><span style="color: #ef4444; font-size: 13px;">(ข้อมูลจะถูกลบออกเฉพาะบนหน้าจอ หากต้องการบันทึกถาวรต้องกดปุ่ม Save ตารางอีกครั้ง)</span>`,
        function() {
            // โค้ดส่วนนี้จะทำงานเมื่อผู้ใช้กดปุ่ม "ยืนยันลบ"
            
            // 1. ล้างข้อมูลวิชาในตัวแปรของเทอมปัจจุบัน
            selectedCourseIds = [];
            selectedCoursesData = [];
            
            // 2. เอาติ๊กถูกออกจาก Checkboxในรายชื่อวิชาด้านล่างทั้งหมด
            document.querySelectorAll('.course-checkbox').forEach(cb => {
                cb.checked = false;
            });

            // 3. อัปเดตตารางหน้าจอให้โล่ง
            updateDatabaseTimetableAndCredits();
            
            // 4. แจ้งเตือนว่าล้างเสร็จแล้ว
            if(typeof showSuccessModal === 'function') {
                showSuccessModal('ล้างตารางสำเร็จ', 'เคลียร์ข้อมูลตารางเรียนบนหน้าจอเรียบร้อยแล้วครับ');
            } else {
                alert('ล้างข้อมูลตารางเรียนเรียบร้อยแล้วครับ');
            }
        }
    );
};


// ==========================================
// 📸 ฟังก์ชันบันทึกตารางเรียนเป็นรูปภาพ (ด้วย html2canvas)
// ==========================================
window.downloadTimetableImage = function(btnElement) {
    const gridElement = document.getElementById('timetable-grid');
    if(!gridElement) return alert('ไม่พบตารางเรียนในหน้าจอครับ');

    // เก็บข้อความเดิมของปุ่มไว้ แล้วเปลี่ยนเป็นสถานะโหลด
    const originalContent = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังประมวลผล...';
    btnElement.disabled = true;

    // สั่งให้ html2canvas ถ่ายภาพเฉพาะส่วนที่เป็นตาราง
    html2canvas(gridElement, {
        scale: 2, // เพิ่มสเกลให้ภาพคมชัดระดับ HD
        backgroundColor: '#1f2937', // ตั้งสีพื้นหลังให้ตรงกับสีตาราง
        useCORS: true // อนุญาตให้ดึงข้อมูลข้ามโดเมน (ถ้ามี)
    }).then(canvas => {
        // แปลงภาพวาดเป็นลิงก์ข้อมูลภาพ PNG
        const imageURL = canvas.toDataURL("image/png");
        
        // จำลองการกดคลิกเพื่อดาวน์โหลดไฟล์ลงเครื่อง
        const link = document.createElement('a');
        link.href = imageURL;
        link.download = `SUT_Schedule_Year${currentYearLevel}_Sem${currentSemester}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // คืนค่าสถานะปุ่มกลับเป็นปกติ
        btnElement.innerHTML = originalContent;
        btnElement.disabled = false;
    }).catch(err => {
        console.error("Error capturing image: ", err);
        alert("เกิดข้อผิดพลาดในการบันทึกรูปภาพครับ กรุณาลองใหม่อีกครั้ง");
        btnElement.innerHTML = originalContent;
        btnElement.disabled = false;
    });
};

// ==========================================
// ➕➖ ระบบเพิ่ม/ลบ ชั้นปีแบบไดนามิก (รองรับแถวเดียวกัน)
// ==========================================
let maxYearCount = 4; // เริ่มต้นที่ 4 ปี

window.addNewYearTab = function() {
    maxYearCount++; 
    const targetYear = maxYearCount; 
    const addBtn = document.getElementById('btn-add-year');
    const removeBtn = document.getElementById('btn-remove-year');
    
    if (!addBtn) return;

    // สร้างปุ่มชั้นปีใหม่
    const newTab = document.createElement('button');
    newTab.className = 'year-tab';
    newTab.innerHTML = `<i class="fa-solid fa-graduation-cap"></i> ชั้นปี ${targetYear}`;
    
    // ผูกระบบสลับหน้าตาราง
    newTab.addEventListener('click', function() {
        const oldKey = `${currentYearLevel}_${currentSemester}`;
        scheduleCache[oldKey] = { 
            ids: JSON.parse(JSON.stringify(selectedCourseIds)), 
            data: JSON.parse(JSON.stringify(selectedCoursesData)) 
        };

        document.querySelectorAll('.year-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        
        currentYearLevel = targetYear; 
        loadSchedule(); 
    });

    // แทรกปุ่มใหม่ไว้ก่อนหน้าปุ่ม "+ เพิ่ม"
    addBtn.parentNode.insertBefore(newTab, addBtn);
    
    // โชว์ปุ่มลบเมื่อมีชั้นปีที่ 5 ขึ้นไป
    if(removeBtn) {
        removeBtn.style.display = 'flex';
    }
};

window.removeNewYearTab = function() {
    if (maxYearCount <= 4) return; 
    
    const targetYear = maxYearCount;
    const tabToRemove = document.querySelectorAll('.year-tab')[targetYear - 1]; 
    
    if (tabToRemove) {
        // ใช้หน้าต่าง Confirm แบบใหม่ที่เราสร้างขึ้นมาแทน alert ดำๆ
        showConfirmModal(
            'ยืนยันการลบชั้นปี', 
            `คุณแน่ใจหรือไม่ว่าต้องการลบ <b>"ชั้นปีที่ ${targetYear}"</b> ออก?<br><span style="color: #ef4444; font-size: 13px;">(ข้อมูลวิชาที่จัดไว้ในชั้นปีนี้จะถูกลบทั้งหมด)</span>`,
            function() {
                // โค้ดนี้จะทำงานเมื่อผู้ใช้กด "ยืนยันลบ"
                tabToRemove.remove();
                
                for(let i = 1; i <= 3; i++) {
                    delete scheduleCache[`${targetYear}_${i}`];
                }

                maxYearCount--;
                
                if (currentYearLevel === targetYear) {
                    const lastTab = document.querySelectorAll('.year-tab')[maxYearCount - 1];
                    if(lastTab) lastTab.click();
                }
                
                const removeBtn = document.getElementById('btn-remove-year');
                if(maxYearCount === 4 && removeBtn) {
                    removeBtn.style.display = 'none';
                }
            }
        );
    }
};
// ==========================================
// ❓ ระบบแจ้งเตือนยืนยัน (Confirm Modal) สไตล์โมเดิร์น
// ==========================================
window.showConfirmModal = function(title, descHTML, onConfirm) {
    let modal = document.getElementById('modal-custom-confirm');
    if (!modal) {
        const html = `
        <div id="modal-custom-confirm" class="chat-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10005; align-items: center; justify-content: center; backdrop-filter: blur(3px);">
            <div style="background: white; width: 90%; max-width: 400px; border-radius: 16px; padding: 30px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.2); animation: fadeIn 0.3s ease;">
                <div style="width: 70px; height: 70px; background: #fee2e2; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px auto;">
                    <i class="fa-solid fa-trash-can" style="font-size: 35px; color: #ef4444;"></i>
                </div>
                <h3 id="confirm-modal-title" style="margin: 0 0 10px 0; color: #1f2937; font-size: 20px; font-weight: 600;">ยืนยัน</h3>
                <div id="confirm-modal-desc" style="color: #4b5563; font-size: 14px; margin-bottom: 25px; line-height: 1.5;"></div>
                <div style="display: flex; gap: 10px;">
                    <button id="btn-confirm-cancel" style="flex: 1; background: #f3f4f6; color: #4b5563; border: none; padding: 12px; border-radius: 10px; font-weight: 600; cursor: pointer; font-family: 'Prompt'; transition: 0.2s;" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='#f3f4f6'">ยกเลิก</button>
                    <button id="btn-confirm-ok" style="flex: 1; background: #ef4444; color: white; border: none; padding: 12px; border-radius: 10px; font-weight: 600; cursor: pointer; font-family: 'Prompt'; transition: 0.2s; box-shadow: 0 4px 6px rgba(239, 68, 68, 0.2);" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">ยืนยันลบ</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        modal = document.getElementById('modal-custom-confirm');
    }

    // กำหนดข้อความ
    document.getElementById('confirm-modal-title').innerText = title;
    document.getElementById('confirm-modal-desc').innerHTML = descHTML;
    modal.style.display = 'flex';

    // ผูกคำสั่งปุ่ม
    document.getElementById('btn-confirm-cancel').onclick = function() {
        modal.style.display = 'none';
    };
    document.getElementById('btn-confirm-ok').onclick = function() {
        modal.style.display = 'none';
        if (typeof onConfirm === 'function') onConfirm();
    };    
};


// ==========================================
// ⚠️ ระบบแจ้งเตือนข้อผิดพลาด (Error / Alert Modal) สไตล์โมเดิร์น
// ==========================================
window.showErrorModal = function(title, descHTML) {
    let modal = document.getElementById('modal-custom-error');
    if (!modal) {
        const html = `
        <div id="modal-custom-error" class="chat-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10010; align-items: center; justify-content: center; backdrop-filter: blur(3px);">
            <div style="background: white; width: 90%; max-width: 380px; border-radius: 16px; padding: 30px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.2); animation: fadeIn 0.3s ease;">
                <div style="width: 70px; height: 70px; background: #fff7ed; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px auto;">
                    <i class="fa-solid fa-circle-exclamation" style="font-size: 35px; color: #F05A28;"></i>
                </div>
                <h3 id="error-modal-title" style="margin: 0 0 10px 0; color: #1f2937; font-size: 20px; font-weight: 600;">แจ้งเตือน</h3>
                <div id="error-modal-desc" style="color: #4b5563; font-size: 14px; margin-bottom: 25px; line-height: 1.5;"></div>
                <button onclick="document.getElementById('modal-custom-error').style.display='none'" style="width: 100%; background: #F05A28; color: white; border: none; padding: 12px; border-radius: 10px; font-weight: 600; cursor: pointer; font-family: 'Prompt'; transition: 0.2s; box-shadow: 0 4px 6px rgba(240, 90, 40, 0.2);" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">เข้าใจแล้ว</button>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        modal = document.getElementById('modal-custom-error');
    }
    
    document.getElementById('error-modal-title').innerText = title;
    document.getElementById('error-modal-desc').innerHTML = descHTML;
    modal.style.display = 'flex';
};

// ==========================================
// 🗑️ ฟังก์ชันยืนยันการลบวิชาบนตาราง (ใช้ Modal สวยงาม)
// ==========================================
window.confirmRemoveCourse = function(courseId, courseCode) {
    showConfirmModal(
        'ยืนยันการลบรายวิชา',
        `ต้องการลบวิชา <b>${courseCode}</b> ออกจากตารางใช่หรือไม่?`,
        function() {
            // คำสั่งนี้จะทำงานเมื่อผู้ใช้กดปุ่ม "ยืนยันลบ" สีแดง
            window.removeCourseFromList(courseId);
        }
    );
};

// ==========================================
// 🎤 ระบบสั่งงานด้วยเสียง (Voice to Text สำหรับ AI) - สไตล์ Gemini (กดเปิด-ปิดเอง)
// ==========================================
let speechRecognition;
let isRecordingVoice = false;
let initialInputValue = ''; // ตัวแปรจำข้อความเดิมในช่องแชทก่อนเปิดไมค์

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = 'th-TH'; 
    speechRecognition.interimResults = true; 
    speechRecognition.continuous = true; // 🔥 จุดสำคัญ: สั่งให้ฟังต่อเนื่อง ไม่ตัดจบเวลาเงียบเสียง
    speechRecognition.maxAlternatives = 1;

    speechRecognition.onstart = function() {
        isRecordingVoice = true;
        
        // จำข้อความเก่าในช่องพิมพ์ไว้ก่อน เผื่อมีการพิมพ์ค้างไว้
        const inputEl = document.getElementById('ai-msg-input');
        initialInputValue = inputEl ? inputEl.value : ''; 
        
        document.getElementById('voice-overlay').style.display = 'flex';
        document.getElementById('voice-interim-text').innerHTML = '<span style="color: #9ca3af;">กำลังฟัง... (พูดเสร็จแล้วกดที่วงกลมเพื่อส่งข้อความ)</span>';
    };

    speechRecognition.onresult = function(event) {
        let completeFinal = '';
        let interim = '';

        // วนลูปประมวลผลคำพูดตั้งแต่เริ่มเปิดไมค์จนถึงปัจจุบัน
        for (let i = 0; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                completeFinal += event.results[i][0].transcript;
            } else {
                interim += event.results[i][0].transcript;
            }
        }

        // แสดงข้อความสดๆ กลางหน้าจอ
        const displayTarget = document.getElementById('voice-interim-text');
        if (displayTarget) {
            displayTarget.innerHTML = completeFinal + '<span style="color: #9ca3af;">' + interim + '</span>';
        }

        // นำข้อความที่สรุปแล้วไปรวมกับข้อความเดิม ยัดลงในช่องแชท
        const inputEl = document.getElementById('ai-msg-input');
        if (inputEl) {
            inputEl.value = (initialInputValue ? initialInputValue + ' ' : '') + completeFinal;
        }
    };

    speechRecognition.onerror = function(event) {
        console.error("Speech error: ", event.error);
        if (event.error === 'not-allowed') {
            alert('⚠️ ไม่สามารถใช้งานไมโครโฟนได้ กรุณากดอนุญาต (Allow) สิทธิ์การใช้ไมโครโฟนที่แถบ URL ด้านบนครับ');
        }
        resetMicUI();
    };

    speechRecognition.onend = function() {
        resetMicUI();
        // ทันทีที่ผู้ใช้กดปุ่มวงกลมเพื่อสั่งหยุด ให้ยิงข้อความส่งไปหา AI อัตโนมัติ
        const inputEl = document.getElementById('ai-msg-input');
        if (inputEl && inputEl.value.trim() !== '') {
            window.sendAIMessage();
        }
    };
} else {
    console.warn("เบราว์เซอร์นี้ไม่รองรับ Speech Recognition API");
}

function resetMicUI() {
    isRecordingVoice = false;
    document.getElementById('voice-overlay').style.display = 'none';
}

// ผูกฟังก์ชันการทำงานเมื่อคลิกที่ปุ่มไมค์หรือวงกลมกลางจอ
window.toggleVoiceRecognition = function() {
    if (!speechRecognition) return alert('⚠️ เบราว์เซอร์ของคุณไม่รองรับระบบสั่งงานด้วยเสียง แนะนำให้ใช้ Google Chrome ครับ');
    
    if (isRecordingVoice) {
        // หากกำลังฟังอยู่แล้วกดอีกครั้ง -> สั่งหยุดฟัง และทำงานต่อที่ onend (ส่งแชท)
        speechRecognition.stop(); 
    } else {
        // หากยังไม่ได้ฟัง -> สั่งเริ่มฟัง
        speechRecognition.start(); 
    }
};

// ==========================================
// 🤝 ฟังก์ชันจัดการคำขอเป็นเพื่อน (รับ/ปฏิเสธ)
// ==========================================
window.handleFriendRequest = async function(requesterId, newStatus) {
    const myId = localStorage.getItem('sut_student_id');
    if (!myId) return;

    try {
        if (newStatus === 'accepted') {
            // ถ้ารับแอด ให้อัปเดตสถานะใน Database เป็น accepted
            const { error } = await supabaseClient
                .from('friendships')
                .update({ status: 'accepted' })
                .eq('requester_id', requesterId)
                .eq('receiver_id', myId);
            
            if (error) throw error;
            showSuccessModal('สำเร็จ!', `คุณได้เป็นเพื่อนกับ ${requesterId} เรียบร้อยแล้ว`);
            
        } else if (newStatus === 'rejected') {
            // ถ้ากดลบ ให้ลบคำขอนั้นออกจาก Database
            const { error } = await supabaseClient
                .from('friendships')
                .delete()
                .eq('requester_id', requesterId)
                .eq('receiver_id', myId);
            
            if (error) throw error;
        }
        
        // รีเฟรชรายชื่อเพื่อนและกล่องคำขอใหม่ทันที
        await loadFriendsData();
        
    } catch (err) {
        console.error("Friend request error: ", err);
        alert('เกิดข้อผิดพลาดในการจัดการคำขอ: ' + err.message);
    }
};