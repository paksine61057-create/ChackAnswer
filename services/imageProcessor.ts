
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

  // เปลี่ยนจาก pro เป็น flash-preview เพื่อให้ใช้งานโควต้าฟรีได้เสถียรขึ้น
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const base64Data = base64DataUrl.replace(/^data:.*;base64,/, '');

  const prompt = `
    คุณคือผู้เชี่ยวชาญด้าน OMR (Optical Mark Recognition). 
    วิเคราะห์ภาพ "ต้นแบบเฉลย" (Answer Key) จำนวน ${questionCount} ข้อ.
    
    หน้าที่สำคัญ:
    1. ระบุพิกัด (x, y, w, h เป็น % 0-100) ของ "ทุกช่องตัวเลือก" (ก, ข, ค, ง, จ)
    2. ในแต่ละข้อ ให้สังเกตว่าช่องใดมี "รอยมาร์ค" (กากบาท X, ฝนดำ, หรือวงกลม) ซึ่งหมายถึงเฉลยที่ครูเลือก
    3. ตั้งค่า "isMarked": true เฉพาะช่องที่ถูกมาร์คเป็นเฉลยเท่านั้น
    4. ตรวจสอบให้ครบทุกข้อ (1 ถึง ${questionCount})
    
    ส่งผลลัพธ์เป็น JSON:
    {
      "boxes": [
        { "questionNumber": 1, "optionLabel": "ก", "x": 12.5, "y": 15.0, "w": 2.0, "h": 1.5, "isMarked": true },
        ...
      ]
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [{ inlineData: { data: base64Data, mimeType: 'image/jpeg' } }, { text: prompt }]
      },
      config: {
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
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("AI ไม่ตอบสนองข้อมูลกลับมา");
    
    const jsonStr = extractJson(text);
    const data = JSON.parse(jsonStr);
    
    if (!data.boxes || !Array.isArray(data.boxes)) {
      throw new Error("รูปแบบข้อมูล JSON ไม่ถูกต้อง");
    }

    const boxes: BoxCoordinate[] = data.boxes.map((b: any, i: number) => ({
      id: `box-${i}`,
      ...b
    }));

    const correctAnswers: Record<number, string> = {};
    data.boxes.forEach((b: any) => {
      if (b.isMarked === true) {
        correctAnswers[b.questionNumber] = b.optionLabel;
      }
    });

    return { boxes, correctAnswers };
  } catch (error: any) {
    console.error("Analysis Error:", error);
    if (error.message?.includes("429") || error.message?.includes("quota")) {
      throw new Error("โควต้า API ของคุณเต็มหรือโมเดลนี้ไม่เปิดให้ใช้ฟรีในบัญชีของคุณ กรุณารอ 1 นาทีหรือตรวจสอบสถานะ Billing ใน Google AI Studio");
    }
    throw new Error("ไม่สามารถวิเคราะห์เฉลยได้: " + error.message);
  }
};

export const checkInkDensity = (ctx: CanvasRenderingContext2D, box: BoxCoordinate, cw: number, ch: number): number => {
  const x = (box.x / 100) * cw;
  const y = (box.y / 100) * ch;
  const w = (box.w / 100) * cw;
  const h = (box.h / 100) * ch;
  
  try {
    const data = ctx.getImageData(x+(w*0.15), y+(h*0.15), w*0.7, h*0.7).data;
    let darkPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
      if (brightness < 165) darkPixels++;
    }
    return darkPixels / (w*0.7 * h*0.7);
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
