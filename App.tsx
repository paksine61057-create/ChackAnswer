
import React, { useState, useRef, useEffect } from 'react';
import { MasterConfig, GradingResult, SubjectInfo } from './types.ts';
import { analyzeMasterSheet, checkInkDensity, fileToBase64 } from './services/imageProcessor.ts';

const Header = () => (
  <header className="bg-blue-700 text-white p-4 shadow-md sticky top-0 z-50">
    <div className="container mx-auto flex justify-between items-center">
      <div className="flex items-center gap-3">
        <i className="fas fa-edit text-2xl"></i>
        <h1 className="text-xl font-bold">Smart Grader AI</h1>
      </div>
      <div className="text-sm font-light">ระบบตรวจข้อสอบสำหรับครูไทย</div>
    </div>
  </header>
);

export default function App() {
  const [step, setStep] = useState<'setup' | 'master' | 'verify' | 'grading' | 'results'>('setup');
  const [subject, setSubject] = useState<SubjectInfo>({ name: '', questionCount: 20 });
  const [masterConfig, setMasterConfig] = useState<MasterConfig | null>(null);
  const [gradingResults, setGradingResults] = useState<GradingResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // สถานะสำหรับ API Key
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ตรวจสอบ API Key เมื่อเริ่มใช้งาน
  useEffect(() => {
    const currentKey = (window as any).process?.env?.API_KEY;
    if (!currentKey || currentKey === "") {
      setShowKeyModal(true);
    }
  }, []);

  const handleSaveKey = () => {
    if (apiKeyInput.trim()) {
      if (!(window as any).process) (window as any).process = { env: {} };
      if (!(window as any).process.env) (window as any).process.env = {};
      
      (window as any).process.env.API_KEY = apiKeyInput.trim();
      setShowKeyModal(false);
      setError(null);
    } else {
      setError("กรุณากรอก API Key ก่อนเริ่มต้นใช้งาน");
    }
  };

  const handleMasterUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // ตรวจสอบ Key อีกครั้งก่อนเรียก API
    if (!(window as any).process?.env?.API_KEY) {
      setShowKeyModal(true);
      return;
    }

    setIsProcessing(true);
    try {
      const base64 = await fileToBase64(file);
      const result = await analyzeMasterSheet(base64, subject.questionCount);
      setMasterConfig({ imageUrl: base64, ...result });
      setStep('verify');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStudentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !masterConfig) return;
    setIsProcessing(true);
    const newResults: GradingResult[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const base64 = await fileToBase64(files[i]);
      const img = new Image();
      img.src = base64;
      await new Promise(resolve => {
        img.onload = () => {
          const canvas = canvasRef.current!;
          const ctx = canvas.getContext('2d')!;
          canvas.width = img.width; canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          
          const details = (Object.entries(masterConfig.correctAnswers) as [string, string][]).map(([qNum, correct]) => {
            const num = parseInt(qNum);
            const choices = masterConfig.boxes.filter(b => b.questionNumber === num);
            const marks = choices.filter(c => checkInkDensity(ctx, c, img.width, img.height) > 0.1);
            const ans = marks.length === 1 ? (marks[0].optionLabel as string) : "";
            return {
              question: num,
              studentAnswer: ans,
              correctAnswer: correct,
              isCorrect: ans === correct,
              isWarning: marks.length > 1
            };
          });
          
          newResults.push({
            studentId: (gradingResults.length + newResults.length + 1).toString(),
            studentName: `นักเรียนคนที่ ${gradingResults.length + newResults.length + 1}`,
            score: details.filter(d => d.isCorrect).length,
            total: subject.questionCount,
            details,
            timestamp: Date.now()
          });
          resolve(null);
        };
      });
    }
    setGradingResults(prev => [...prev, ...newResults].sort((a,b) => parseInt(a.studentId) - parseInt(b.studentId)));
    setStep('results');
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-['Kanit']">
      <Header />
      
      <main className="container mx-auto p-4 py-8 max-w-4xl">
        {/* API Key Input Modal */}
        {showKeyModal && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 animate-fadeIn border border-blue-100">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <i className="fas fa-key text-2xl"></i>
                </div>
                <h2 className="text-2xl font-bold text-slate-800">ตั้งค่า API Key</h2>
                <p className="text-slate-500 text-sm mt-2">กรุณากรอก Gemini API Key เพื่อเปิดใช้งานระบบ AI</p>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2 ml-1">รหัส API Key</label>
                  <input 
                    type="password" 
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="ใสลับ API Key ของคุณที่นี่..."
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all font-mono"
                  />
                </div>
                
                <button 
                  onClick={handleSaveKey}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                >
                  <i className="fas fa-save"></i> บันทึกและเริ่มใช้งาน
                </button>
                
                <div className="text-center">
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-xs text-blue-600 hover:underline"
                  >
                    ขอ API Key ฟรีได้ที่ Google AI Studio
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Setup */}
        {step === 'setup' && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border animate-fadeIn">
            <h2 className="text-2xl font-bold mb-6 text-slate-800 border-b pb-4">1. ข้อมูลรายวิชา</h2>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">ชื่อรายวิชา</label>
                <input 
                  type="text" 
                  className="w-full border-2 border-slate-100 p-4 rounded-xl focus:border-blue-500 outline-none transition-all"
                  placeholder="เช่น คณิตศาสตร์ ม.3 เทอม 1"
                  value={subject.name}
                  onChange={e => setSubject({...subject, name: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">จำนวนข้อสอบ (ข้อ)</label>
                <input 
                  type="number" 
                  className="w-full border-2 border-slate-100 p-4 rounded-xl focus:border-blue-500 outline-none transition-all"
                  value={subject.questionCount}
                  onChange={e => setSubject({...subject, questionCount: parseInt(e.target.value) || 0})}
                />
              </div>
              <button 
                disabled={!subject.name || subject.questionCount <= 0}
                onClick={() => setStep('master')}
                className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 disabled:opacity-50 shadow-lg shadow-blue-200"
              >
                ถัดไป: อัปโหลดเฉลย
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Master Upload */}
        {step === 'master' && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border animate-fadeIn text-center">
            <h2 className="text-2xl font-bold mb-2">2. อัปโหลดต้นแบบเฉลย</h2>
            <p className="text-slate-500 mb-8 font-bold text-blue-600">วิชา: {subject.name} ({subject.questionCount} ข้อ)</p>
            <label className="border-4 border-dashed border-slate-100 rounded-3xl p-12 block cursor-pointer hover:bg-slate-50 transition-all">
              <i className="fas fa-cloud-upload-alt text-5xl text-blue-500 mb-4"></i>
              <span className="block text-lg font-bold">เลือกไฟล์ภาพเฉลย</span>
              <input type="file" className="hidden" accept="image/*" onChange={handleMasterUpload} />
            </label>
            <button onClick={() => setStep('setup')} className="mt-6 text-slate-400 hover:text-blue-600">ย้อนกลับ</button>
          </div>
        )}

        {/* Step 3: Verification */}
        {step === 'verify' && masterConfig && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border animate-fadeIn">
            <div className="flex justify-between items-center mb-6 border-b pb-4">
              <div>
                <h2 className="text-2xl font-bold text-green-600">3. ตรวจสอบข้อมูลเฉลย</h2>
                <p className="text-slate-500 text-sm italic">วิชา: {subject.name}</p>
              </div>
              <button onClick={() => setStep('master')} className="text-slate-400 hover:text-blue-600 text-sm">เปลี่ยนภาพเฉลย</button>
            </div>
            
            <div className="max-h-96 overflow-y-auto border rounded-xl mb-6 bg-slate-50/30">
              <table className="w-full">
                <thead className="bg-slate-100 sticky top-0 shadow-sm">
                  <tr>
                    <th className="p-3 text-left border-b w-1/2">ข้อที่</th>
                    <th className="p-3 text-center border-b w-1/2">คำตอบเฉลย</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {Array.from({length: subject.questionCount}).map((_, i) => {
                    const qNum = i + 1;
                    return (
                      <tr key={qNum} className="hover:bg-white transition-colors">
                        <td className="p-3 font-bold text-slate-600 px-6">ข้อที่ {qNum}</td>
                        <td className="p-3 text-center">
                          <select 
                            value={masterConfig.correctAnswers[qNum] || ''}
                            onChange={(e) => setMasterConfig({
                              ...masterConfig, 
                              correctAnswers: {...masterConfig.correctAnswers, [qNum]: e.target.value}
                            })}
                            className="border-2 border-slate-200 p-2 rounded-lg w-24 text-center font-bold text-blue-600 focus:border-blue-400 outline-none transition-all"
                          >
                            <option value="">-</option>
                            <option value="ก">ก</option>
                            <option value="ข">ข</option>
                            <option value="ค">ค</option>
                            <option value="ง">ง</option>
                            <option value="จ">จ</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            <button 
              onClick={() => setStep('grading')}
              className="w-full bg-green-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-green-700 shadow-lg"
            >
              ยืนยันเฉลยและเริ่มตรวจข้อสอบนักเรียน
            </button>
          </div>
        )}

        {/* Step 4: Grading */}
        {step === 'grading' && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border animate-fadeIn text-center">
            <h2 className="text-2xl font-bold mb-2">4. ตรวจข้อสอบนักเรียน</h2>
            <p className="text-slate-500 mb-8 font-bold text-blue-600">วิชา: {subject.name}</p>
            <label className="border-4 border-dashed border-blue-100 bg-blue-50/50 rounded-3xl p-12 block cursor-pointer hover:bg-blue-50 transition-all border-spacing-4">
              <i className="fas fa-camera text-5xl text-blue-600 mb-4"></i>
              <span className="block text-xl font-bold text-blue-800">อัปโหลดกระดาษคำตอบนักเรียน</span>
              <span className="text-sm text-blue-600 opacity-70">เลือกได้หลายไฟล์พร้อมกันเพื่อตรวจเป็นชุด</span>
              <input type="file" className="hidden" accept="image/*" multiple onChange={handleStudentUpload} />
            </label>
            <button onClick={() => setStep('verify')} className="mt-6 text-slate-400 hover:text-blue-600">ย้อนกลับไปดูเฉลย</button>
          </div>
        )}

        {/* Step 5: Results */}
        {step === 'results' && (
          <div className="animate-fadeIn">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
              <div>
                <h2 className="text-2xl font-bold">ผลการตรวจ: {subject.name}</h2>
                <p className="text-slate-500 text-sm">เรียงตามลำดับการอัปโหลด (สามารถส่งออกเพื่อนำไปเรียงลำดับใน Excel ได้)</p>
              </div>
              <div className="flex gap-2 w-full md:w-auto">
                <button onClick={() => window.print()} className="flex-1 md:flex-none bg-white border border-slate-200 px-4 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-50">
                  <i className="fas fa-file-excel text-green-600"></i> ส่งออก Excel
                </button>
                <button onClick={() => setStep('grading')} className="flex-1 md:flex-none bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700">
                  ตรวจเพิ่ม
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="p-4 font-bold text-slate-500 uppercase text-xs">เลขที่</th>
                      <th className="p-4 font-bold text-slate-500 uppercase text-xs">ชื่อ-นามสกุล</th>
                      <th className="p-4 font-bold text-slate-500 uppercase text-xs">คะแนน</th>
                      <th className="p-4 font-bold text-slate-500 uppercase text-xs text-right">สถานะการตรวจ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {gradingResults.map((res, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 font-bold text-slate-700">{res.studentId}</td>
                        <td className="p-4 text-slate-600">{res.studentName}</td>
                        <td className="p-4">
                          <span className="text-xl font-bold text-blue-600">{res.score}</span>
                          <span className="text-slate-400 text-sm"> / {res.total}</span>
                        </td>
                        <td className="p-4 text-right">
                          {res.details.some(d => d.isWarning) ? (
                            <span className="text-amber-600 text-[10px] font-bold bg-amber-50 px-2 py-1 rounded-full border border-amber-100">
                              <i className="fas fa-exclamation-circle mr-1"></i> มีรอยซ้ำ
                            </span>
                          ) : (
                            <span className="text-green-600 text-[10px] font-bold bg-green-50 px-2 py-1 rounded-full border border-green-100">
                              <i className="fas fa-check-circle mr-1"></i> เรียบร้อย
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
            <button 
              onClick={() => {
                setStep('setup');
                setGradingResults([]);
                setMasterConfig(null);
              }} 
              className="mt-8 text-slate-400 hover:text-blue-600 block mx-auto underline text-sm"
            >
              เริ่มต้นตรวจวิชาใหม่
            </button>
          </div>
        )}

        {isProcessing && (
          <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[200] flex flex-col items-center justify-center text-white p-6 text-center">
            <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mb-6"></div>
            <p className="font-bold text-xl mb-2">AI กำลังประมวลผลกระดาษคำตอบ...</p>
            <p className="text-blue-200 text-sm max-w-xs">ขั้นตอนนี้อาจใช้เวลา 10-20 วินาที ขึ้นอยู่กับความละเอียดของภาพ</p>
          </div>
        )}

        {error && (
          <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-xl border border-red-100 flex items-center gap-3 animate-fadeIn">
            <i className="fas fa-exclamation-triangle text-xl"></i>
            <div className="flex-grow">
              <p className="font-bold text-sm">เกิดข้อผิดพลาด</p>
              <p className="text-xs">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="p-2 hover:bg-red-100 rounded-lg transition-colors">
              <i className="fas fa-times"></i>
            </button>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </main>
      
      <footer className="mt-auto py-8 text-center text-slate-400 text-xs border-t bg-white">
        &copy; 2024 Smart Grader AI for Thai Teachers | พัฒนาเพื่อสนับสนุนการศึกษาไทย
      </footer>
    </div>
  );
}
