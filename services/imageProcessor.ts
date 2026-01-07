
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
    วิเคราะห์ภาพ "ต้นแบบเฉลย" (Answer Key) จำนวน ${questionCount} ข้อ.
    
    ลักษณะการวางเลย์เอาต์:
    - ข้อสอบแต่ละข้อจะจัดวางเป็นแถวแนวนอน
    - ในแต่ละข้อจะมีช่องคำตอบ 4 ช่อง เรียงจากซ้ายไปขวา คือ: ช่องที่ 1 (ก), ช่องที่ 2 (ข), ช่องที่ 3 (ค), และช่องที่ 4 (ง)
    - เฉลยที่ถูกต้องจะถูกระบุด้วย "รอยกากบาท (X)" หรือรอยขีดเขียนชัดเจนภายในช่องใดช่องหนึ่ง
    
    ภารกิจของคุณ:
    1. ตรวจหาพิกัด (x, y, w, h เป็น % 0-100) ของทั้ง 4 ช่อง (ก, ข, ค, ง) สำหรับทุกข้อ (1 ถึง ${questionCount})
    2. วิเคราะห์รอยมาร์ค: ในแต่ละข้อ ให้ระบุว่าช่องใด (ก, ข, ค หรือ ง) ที่ครูทำเครื่องหมาย "กากบาท (X)" ไว้
    3. ตั้งค่า "isMarked": true เฉพาะช่องที่มีรอยกากบาทนั้น (1 ข้อต้องมี isMarked: true เพียง 1 ช่อง)
    4. ตรวจสอบให้ครบทุกข้อ ห้ามข้ามลำดับ
    
    ส่งผลลัพธ์เป็น JSON ตาม Schema ที่กำหนด.
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
        systemInstruction: "คุณคือระบบ OMR อัจฉริยะที่เชี่ยวชาญการตรวจจับรอยกากบาท (X) ในช่องคำตอบแบบแนวนอน 4 ตัวเลือก (ก, ข, ค, ง) หน้าที่ของคุณคือระบุตำแหน่งของทุกช่องและชี้ชัดว่าช่องใดคือเฉลยที่ครูมาร์คไว้",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            boxes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionNumber: { type: Type.INTEGER },
                  optionLabel: { type: Type.STRING },
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  w: { type: Type.NUMBER },
                  h: { type: Type.NUMBER },
                  isMarked: { type: Type.BOOLEAN }
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
      throw new Error("ข้อมูลที่ได้รับไม่อยู่ในรูปแบบที่กำหนด");
    }

    const boxes: BoxCoordinate[] = data.boxes.map((b: any, i: number) => ({
      id: `box-${i}`,
      ...b
    }));

    // สร้าง Map สำหรับเฉลยที่ถูกต้อง
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
    const data = ctx.getImageData(x+(w*0.2), y+(h*0.2), w*0.6, h*0.6).data;
    let darkPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
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
