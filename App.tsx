
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { MasterConfig, GradingResult, BoxCoordinate } from './types.ts';
import { analyzeMasterSheet, checkInkDensity, fileToBase64 } from './services/imageProcessor.ts';

// --- Helper Components ---

const Header: React.FC = () => (
  <header className="bg-blue-600 text-white p-4 shadow-lg sticky top-0 z-50">
    <div className="container mx-auto flex justify-between items-center">
      <div className="flex items-center gap-3">
        <div className="bg-white text-blue-600 p-2 rounded-lg">
          <i className="fas fa-graduation-cap text-2xl"></i>
        </div>
        <div>
          <h1 className="text-xl font-bold leading-none">Smart Grader AI</h1>
          <p className="text-xs text-blue-100">ระบบตรวจข้อสอบอัจฉริยะสำหรับครูไทย</p>
        </div>
      </div>
      <div className="hidden md:block">
        <span className="bg-blue-500 text-xs px-3 py-1 rounded-full border border-blue-400">
          <i className="fas fa-circle text-green-400 mr-2"></i> ระบบพร้อมใช้งาน
        </span>
      </div>
    </div>
  </header>
);

const Footer: React.FC = () => (
  <footer className="bg-slate-800 text-slate-400 py-8 mt-12">
    <div className="container mx-auto px-4 text-center">
      <p className="text-sm">© 2024 Smart Exam Grader System. พัฒนาเพื่อสนับสนุนคุณครูทั่วประเทศไทย</p>
      <div className="flex justify-center gap-6 mt-4 opacity-50">
        <i className="fab fa-facebook text-xl hover:text-white cursor-pointer"></i>
        <i className="fab fa-line text-xl hover:text-white cursor-pointer"></i>
        <i className="fas fa-envelope text-xl hover:text-white cursor-pointer"></i>
      </div>
    </div>
  </footer>
);

// --- Main Application Logic ---

export default function App() {
  const [step, setStep] = useState<'welcome' | 'master' | 'grading' | 'results'>('welcome');
  const [isProcessing, setIsProcessing] = useState(false);
  const [masterConfig, setMasterConfig] = useState<MasterConfig | null>(null);
  const [gradingResults, setGradingResults] = useState<GradingResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // API Key State
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [inputKey, setInputKey] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ตรวจสอบ API Key เมื่อเริ่มใช้งาน
  useEffect(() => {
    if (!process.env.API_KEY || process.env.API_KEY === "") {
      setShowApiKeyInput(true);
    }
  }, []);

  const handleSaveApiKey = () => {
    if (inputKey.trim()) {
      (window as any).process.env.API_KEY = inputKey.trim();
      setShowApiKeyInput(false);
      setErrorMessage(null);
    } else {
      setErrorMessage("กรุณากรอก API Key ก่อนใช้งาน");
    }
  };

  // 1. Setup Master Sheet
  const handleMasterUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!process.env.API_KEY || process.env.API_KEY === "") {
      setShowApiKeyInput(true);
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const base64Full = await fileToBase64(file);
      const result = await analyzeMasterSheet(base64Full);
      
      setMasterConfig({
        imageUrl: base64Full,
        boxes: result.boxes,
        correctAnswers: result.correctAnswers
      });
      setStep('grading');
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "ไม่สามารถวิเคราะห์กระดาษต้นแบบได้ กรุณาลองใหม่ด้วยภาพที่ชัดเจนกว่านี้");
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Grade Student Sheets
  const handleStudentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !masterConfig) return;

    setIsProcessing(true);
    const newResults: GradingResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const base64Full = await fileToBase64(file);
      const img = new Image();
      img.src = base64Full;

      await new Promise((resolve) => {
        img.onload = () => {
          const canvas = canvasRef.current;
          if (!canvas) return resolve(null);
          
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);

          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);

          const studentAnswers: Record<number, { label: string, density: number }[]> = {};
          
          masterConfig.boxes.forEach(box => {
            const density = checkInkDensity(ctx, box, canvas.width, canvas.height);
            if (!studentAnswers[box.questionNumber]) studentAnswers[box.questionNumber] = [];
            // เกณฑ์การตรวจจับรอยปากกานักเรียน (Ink threshold 8%)
            if (density > 0.08) { 
              studentAnswers[box.questionNumber].push({ label: box.optionLabel, density });
            }
          });

          const details = Object.entries(masterConfig.correctAnswers).map(([qNumStr, correct]) => {
            const qNum = parseInt(qNumStr);
            const marks = studentAnswers[qNum] || [];
            const studentAns = marks.length === 1 ? marks[0].label : null;
            const isWarning = marks.length > 1; 
            const correctStr = correct as string;

            return {
              question: qNum,
              studentAnswer: studentAns,
              correctAnswer: correctStr,
              isCorrect: studentAns === correctStr,
              isWarning: isWarning
            };
          });

          const score = details.filter(d => d.isCorrect).length;

          newResults.push({
            studentId: `STU-${Math.floor(1000 + Math.random() * 9000)}`,
            score: score,
            total: details.length,
            details: details,
            timestamp: Date.now()
          });
          resolve(null);
        };
      });
    }

    setGradingResults(prev => [...prev, ...newResults]);
    setIsProcessing(false);
    setStep('results');
  };

  const resetSystem = () => {
    setMasterConfig(null);
    setGradingResults([]);
    setStep('welcome');
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-grow container mx-auto px-4 py-8">
        {/* API Key Modal */}
        {showApiKeyInput && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 animate-fadeIn border border-blue-100">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <i className="fas fa-key text-2xl"></i>
                </div>
                <h2 className="text-2xl font-bold text-slate-800">กรุณาตั้งค่า API Key</h2>
                <p className="text-slate-500 text-sm mt-2">เพื่อเปิดใช้งานระบบตรวจข้อสอบด้วย AI (Gemini)</p>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2 ml-1">Gemini API Key</label>
                  <input 
                    type="password" 
                    value={inputKey}
                    onChange={(e) => setInputKey(e.target.value)}
                    placeholder="ใส่รหัส API Key ของคุณที่นี่..."
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all font-mono"
                  />
                </div>
                
                <button 
                  onClick={handleSaveApiKey}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                >
                  <i className="fas fa-save"></i> บันทึกและเริ่มใช้งาน
                </button>
                
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    <i className="fas fa-info-circle mr-1"></i> 
                    รหัสนี้จะถูกใช้เพื่อประมวลผลรูปภาพเท่านั้น คุณสามารถขอรหัสฟรีได้ที่ 
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-bold ml-1">Google AI Studio</a>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step Wizard */}
        <div className="max-w-4xl mx-auto mb-10">
          <div className="flex items-center justify-between text-xs md:text-sm font-medium text-slate-400">
            <div className={`flex flex-col items-center gap-2 ${step === 'welcome' ? 'text-blue-600' : 'text-slate-600'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${step === 'welcome' ? 'border-blue-600 bg-blue-50' : 'border-slate-300'}`}>1</div>
              <span>ยินดีต้อนรับ</span>
            </div>
            <div className="h-px bg-slate-200 flex-grow mx-4 mb-6"></div>
            <div className={`flex flex-col items-center gap-2 ${step === 'master' ? 'text-blue-600' : 'text-slate-600'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${step === 'master' ? 'border-blue-600 bg-blue-50' : 'border-slate-300'}`}>2</div>
              <span>ตั้งค่าเฉลย</span>
            </div>
            <div className="h-px bg-slate-200 flex-grow mx-4 mb-6"></div>
            <div className={`flex flex-col items-center gap-2 ${step === 'grading' ? 'text-blue-600' : 'text-slate-600'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${step === 'grading' ? 'border-blue-600 bg-blue-50' : 'border-slate-300'}`}>3</div>
              <span>ตรวจข้อสอบ</span>
            </div>
            <div className="h-px bg-slate-200 flex-grow mx-4 mb-6"></div>
            <div className={`flex flex-col items-center gap-2 ${step === 'results' ? 'text-blue-600' : 'text-slate-600'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${step === 'results' ? 'border-blue-600 bg-blue-50' : 'border-slate-300'}`}>4</div>
              <span>สรุปผล</span>
            </div>
          </div>
        </div>

        {/* --- Screen: Welcome --- */}
        {step === 'welcome' && (
          <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden animate-fadeIn">
            <div className="md:flex">
              <div className="md:w-1/2 p-10 bg-blue-600 text-white flex flex-col justify-center">
                <h2 className="text-3xl font-bold mb-4">เปลี่ยนมือถือของคุณให้เป็น เครื่องตรวจข้อสอบ</h2>
                <p className="text-blue-100 mb-6">ใช้ AI ช่วยประมวลผลกระดาษคำตอบเดิมของโรงเรียน ไม่ต้องพิมพ์กระดาษใหม่ แม่นยำ และเร็วขึ้น 10 เท่า</p>
                <ul className="space-y-3">
                  <li className="flex items-center gap-3"><i className="fas fa-check-circle text-green-400"></i> ใช้กระดาษแบบไหนก็ได้</li>
                  <li className="flex items-center gap-3"><i className="fas fa-check-circle text-green-400"></i> ตรวจรอยปากกาโดยเฉพาะ</li>
                  <li className="flex items-center gap-3"><i className="fas fa-check-circle text-green-400"></i> สรุปผลเป็น Excel ทันที</li>
                </ul>
              </div>
              <div className="md:w-1/2 p-10 flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mb-6">
                  <i className="fas fa-file-invoice text-3xl text-blue-600"></i>
                </div>
                <h3 className="text-xl font-bold mb-2">เริ่มจาก "กระดาษต้นแบบ"</h3>
                <p className="text-slate-500 mb-8 text-sm">อัปโหลดภาพกระดาษคำตอบที่ครูกากบาทเฉลยไว้ เพื่อให้ AI เรียนรู้ตำแหน่งช่อง</p>
                <label className="w-full cursor-pointer bg-slate-900 hover:bg-black text-white py-4 rounded-xl font-medium transition-all flex items-center justify-center gap-3">
                  <i className="fas fa-camera"></i>
                  ถ่ายภาพหรืออัปโหลดต้นแบบ
                  <input type="file" className="hidden" accept="image/*" onChange={handleMasterUpload} />
                </label>
                <button 
                  onClick={() => setShowApiKeyInput(true)}
                  className="mt-4 text-xs text-slate-400 hover:text-blue-600 underline"
                >
                  <i className="fas fa-cog mr-1"></i> ตั้งค่า API Key
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- Screen: Grading Process --- */}
        {step === 'grading' && masterConfig && (
          <div className="max-w-4xl mx-auto space-y-8 animate-fadeIn">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <i className="fas fa-tasks text-blue-600"></i> ขั้นตอนการตรวจข้อสอบ
                </h2>
                <button onClick={resetSystem} className="text-red-500 text-sm hover:underline">เปลี่ยนต้นแบบ</button>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                <div className="relative border rounded-xl overflow-hidden bg-slate-50 aspect-[3/4] flex items-center justify-center">
                   <img src={masterConfig.imageUrl} className="max-h-full object-contain opacity-50" alt="Master" />
                   <div className="absolute inset-0 p-4 pointer-events-none">
                      {masterConfig.boxes.map(box => (
                        <div 
                          key={box.id} 
                          className={`absolute border-2 ${masterConfig.correctAnswers[box.questionNumber] === box.optionLabel ? 'border-green-500 bg-green-500/20' : 'border-blue-300/30'}`}
                          style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }}
                        />
                      ))}
                   </div>
                   <div className="absolute bottom-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold shadow-sm">
                      AI วิเคราะห์ตำแหน่งช่องคำตอบสำเร็จ
                   </div>
                </div>

                <div className="flex flex-col justify-center gap-6">
                   <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-xl text-yellow-800 text-sm">
                      <p className="font-bold mb-1"><i className="fas fa-lightbulb mr-2"></i> คำแนะนำสำหรับคุณครู</p>
                      <p>คุณสามารถถ่ายภาพกระดาษนักเรียนหลายแผ่นพร้อมกัน หรือถ่ายทีละแผ่นก็ได้ ระบบจะแยกคะแนนให้รายบุคคล</p>
                   </div>
                   
                   <label className="w-full cursor-pointer bg-blue-600 hover:bg-blue-700 text-white py-6 rounded-2xl font-bold text-lg transition-all flex flex-col items-center justify-center gap-3 shadow-lg hover:scale-[1.02]">
                      <i className="fas fa-file-medical text-3xl"></i>
                      เริ่มตรวจกระดาษคำตอบนักเรียน
                      <input type="file" className="hidden" accept="image/*" multiple onChange={handleStudentUpload} />
                   </label>
                   
                   <p className="text-center text-slate-400 text-xs">รองรับไฟล์ JPG, PNG และการถ่ายจากกล้องมือถือ</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- Screen: Results --- */}
        {step === 'results' && (
          <div className="max-w-6xl mx-auto animate-fadeIn">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
              <div>
                <h2 className="text-2xl font-bold">ผลการตรวจข้อสอบ ({gradingResults.length} แผ่น)</h2>
                <p className="text-slate-500">ตรวจสอบและส่งออกผลคะแนนเป็นตาราง</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => window.print()} className="bg-white border border-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 flex items-center gap-2">
                  <i className="fas fa-print"></i> พิมพ์รายงาน
                </button>
                <button onClick={resetSystem} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-black flex items-center gap-2">
                  <i className="fas fa-plus"></i> ตรวจชุดใหม่
                </button>
              </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
               <div className="lg:col-span-2 space-y-4">
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-wider border-b">
                        <tr>
                          <th className="px-6 py-4">รหัส/ชื่อนักเรียน</th>
                          <th className="px-6 py-4">คะแนน</th>
                          <th className="px-6 py-4">สถานะ</th>
                          <th className="px-6 py-4 text-right">การจัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {gradingResults.map((res, idx) => (
                          <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                            <td className="px-6 py-4 font-medium text-slate-900">{res.studentId}</td>
                            <td className="px-6 py-4">
                              <span className="text-lg font-bold text-blue-600">{res.score}</span>
                              <span className="text-slate-400 text-sm"> / {res.total}</span>
                            </td>
                            <td className="px-6 py-4">
                              {res.details.some(d => d.isWarning) ? (
                                <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 w-max">
                                  <i className="fas fa-exclamation-triangle"></i> มีข้อที่กาซ้ำ
                                </span>
                              ) : (
                                <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 w-max">
                                  <i className="fas fa-check-circle"></i> ตรวจสำเร็จ
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button className="text-blue-500 hover:text-blue-700 text-sm font-bold">ดูรายละเอียด</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
               </div>

               <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <h3 className="font-bold mb-4 flex items-center gap-2">
                      <i className="fas fa-chart-pie text-blue-600"></i> สถิติภาพรวม
                    </h3>
                    <div className="space-y-4">
                      <div className="flex justify-between items-end">
                         <span className="text-slate-500 text-sm">ค่าเฉลี่ย</span>
                         <span className="text-2xl font-bold">
                           {gradingResults.length > 0 
                            ? (gradingResults.reduce((acc, curr) => acc + curr.score, 0) / gradingResults.length).toFixed(2) 
                            : '0.00'}
                         </span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div className="bg-blue-600 h-full" style={{ width: gradingResults.length > 0 ? '65%' : '0%' }}></div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                        <div>
                          <p className="text-slate-400 text-[10px] uppercase font-bold">สูงสุด</p>
                          <p className="text-xl font-bold text-green-600">{gradingResults.length > 0 ? Math.max(...gradingResults.map(r => r.score)) : 0}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-[10px] uppercase font-bold">ต่ำสุด</p>
                          <p className="text-xl font-bold text-red-500">{gradingResults.length > 0 ? Math.min(...gradingResults.map(r => r.score)) : 0}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                    <h3 className="font-bold mb-2 text-blue-900">ส่งออกข้อมูล</h3>
                    <p className="text-sm text-blue-700 mb-4">ดาวน์โหลดผลการตรวจข้อสอบทั้งหมดเป็นไฟล์เพื่อนำไปใช้ใน Excel หรือบันทึกคะแนน</p>
                    <button className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-sm transition-all">
                      <i className="fas fa-file-excel"></i> ดาวน์โหลด (.XLSX)
                    </button>
                  </div>
               </div>
            </div>
          </div>
        )}

        {/* Global Loading Spinner */}
        {isProcessing && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex flex-col items-center justify-center text-white text-center px-4">
            <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="font-bold text-xl mb-2">AI กำลังวิเคราะห์ข้อมูล...</p>
            <p className="text-blue-200 text-sm max-w-xs">ขั้นตอนนี้ใช้เวลาประมาณ 10-20 วินาที ขึ้นอยู่กับความซับซ้อนของกระดาษ</p>
          </div>
        )}

        {/* Error Notification */}
        {errorMessage && (
          <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-4 rounded-2xl shadow-2xl z-[110] flex items-center gap-4 animate-bounce max-w-[90vw]">
            <i className="fas fa-exclamation-circle text-2xl flex-shrink-0"></i>
            <div className="overflow-hidden">
              <p className="font-bold">เกิดข้อผิดพลาด</p>
              <p className="text-xs opacity-90 truncate">{errorMessage}</p>
            </div>
            <button onClick={() => setErrorMessage(null)} className="ml-4 hover:scale-110 flex-shrink-0">
              <i className="fas fa-times"></i>
            </button>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </main>

      <Footer />
    </div>
  );
}
