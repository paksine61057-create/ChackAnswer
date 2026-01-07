
import { GoogleGenAI, Type } from "@google/genai";
import { BoxCoordinate } from "../types.ts";

const extractJson = (text: string): string => {
  const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (match) return match[0];
  return text;
};

export const analyzeMasterSheet = async (
  base64DataUrl: string, 
  questionCount: number
): Promise<{ boxes: BoxCoordinate[], correctAnswers: Record<number, string> }> => {
  const apiKey = (process.env.API_KEY || (window as any).process?.env?.API_KEY) as string;
  
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("กรุณากรอก API Key ในช่องตั้งค่าก่อนเริ่มการประมวลผล");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const base64Data = base64DataUrl.replace(/^data:.*;base64,/, '');

  const prompt = `
    คุณคือผู้เชี่ยวชาญด้าน OMR (Optical Mark Recognition). วิเคราะห์ภาพ "กระดาษคำตอบต้นแบบเฉลย" (Master Answer Key) จำนวน ${questionCount} ข้อ.
    
    ภารกิจ:
    1. ค้นหาตำแหน่งของช่องตัวเลือกทั้งหมด (ก, ข, ค, ง, จ) สำหรับทุกข้อ (1 ถึง ${questionCount}).
    2. ระบุว่าช่องตัวเลือกใดที่ "ครูได้ทำเครื่องหมายเฉลยไว้" (เช่น การกากบาท X, การฝนดำเต็มช่อง, หรือการวงกลมล้อมรอบรหัสตัวเลือก).
    3. ในแต่ละข้อ จะต้องมีเฉลยที่ถูกต้อง "เพียงตัวเลือกเดียว" เท่านั้นที่ถูกตั้งค่าเป็น isMarked: true.
    4. ห้ามข้ามข้อ ตรวจสอบให้ครบถ้วนตั้งแตข้อ 1 จนถึงข้อที่ ${questionCount}.
    
    คำอธิบายการแมป: ก=A, ข=B, ค=C, ง=D, จ=E.
    
    ส่งผลลัพธ์เป็นรูปแบบ JSON ตาม Schema ที่กำหนดไว้อย่างเคร่งครัด.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType: 'image/jpeg' } }, 
          { text: prompt }
        ]
      },
      config: {
        systemInstruction: "คุณคือระบบ AI ตรวจข้อสอบอัจฉริยะ ทำหน้าที่วิเคราะห์ตำแหน่งของช่องคำตอบและระบุตัวเลือกที่ครูมาร์คเป็นเฉลยจากภาพต้นแบบ (Master Key) ด้วยความแม่นยำสูงสุด",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            boxes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionNumber: { type: Type.INTEGER, description: "ลำดับข้อสอบ" },
                  optionLabel: { type: Type.STRING, description: "ตัวเลือก (ก, ข, ค, ง, จ)" },
                  x: { type: Type.NUMBER, description: "พิกัด X (0-100%)" },
                  y: { type: Type.NUMBER, description: "พิกัด Y (0-100%)" },
                  w: { type: Type.NUMBER, description: "ความกว้าง (0-100%)" },
                  h: { type: Type.NUMBER, description: "ความสูง (0-100%)" },
                  isMarked: { type: Type.BOOLEAN, description: "จริง หากเป็นช่องที่ครูมาร์คเฉลยไว้" }
                },
                required: ['questionNumber', 'optionLabel', 'x', 'y', 'w', 'h', 'isMarked']
              }
            }
          }
        },
        thinkingConfig: { thinkingBudget: 2000 }
      }
    });

    const text = response.text;
    if (!text) throw new Error("AI ไม่สามารถส่งข้อมูลการวิเคราะห์ภาพได้");
    
    const jsonStr = extractJson(text);
    const data = JSON.parse(jsonStr);
    
    if (!data.boxes || !Array.isArray(data.boxes)) {
      throw new Error("ข้อมูล JSON ที่ได้รับไม่ถูกต้อง");
    }

    const boxes: BoxCoordinate[] = data.boxes.map((b: any, i: number) => ({
      id: `box-${i}`,
      ...b
    }));

    // สร้างตารางเฉลยคำตอบ (Correct Answers Map)
    const correctAnswers: Record<number, string> = {};
    data.boxes.forEach((b: any) => {
      if (b.isMarked === true) {
        correctAnswers[b.questionNumber] = b.optionLabel;
      }
    });

    return { boxes, correctAnswers };
  } catch (error: any) {
    console.error("Master Analysis Detailed Error:", error);
    if (error.message?.includes("429") || error.message?.includes("quota")) {
      throw new Error("โควต้า API เต็มชั่วคราว กรุณารอ 30 วินาทีแล้วลองใหม่อีกครั้ง");
    }
    throw new Error("ระบบไม่สามารถระบุเฉลยได้: " + error.message);
  }
};

export const checkInkDensity = (ctx: CanvasRenderingContext2D, box: BoxCoordinate, cw: number, ch: number): number => {
  const x = (box.x / 100) * cw;
  const y = (box.y / 100) * ch;
  const w = (box.w / 100) * cw;
  const h = (box.h / 100) * ch;
  
  try {
    // วิเคราะห์ความเข้มเฉพาะส่วนกลางของช่อง (60% ตรงกลาง) เพื่อหลีกเลี่ยงเส้นขอบ
    const data = ctx.getImageData(x+(w*0.2), y+(h*0.2), w*0.6, h*0.6).data;
    let darkPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
      // ความสว่างน้อยกว่า 160 ถือเป็นรอยดำ/รอยมาร์ค
      if (brightness < 160) darkPixels++;
    }
    return darkPixels / (w*0.6 * h*0.6);
  } catch (e) { 
    return 0; 
  }
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((r, j) => {
    const rd = new FileReader();
    rd.readAsDataURL(file);
    rd.onload = () => r(rd.result as string);
    rd.onerror = e => j(e);
  });
};
