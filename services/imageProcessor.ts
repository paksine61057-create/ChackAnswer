
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

  // ใช้ gemini-3-pro-preview สำหรับงานวิเคราะห์ภาพที่ต้องการความแม่นยำสูง
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const base64Data = base64DataUrl.replace(/^data:.*;base64,/, '');

  const prompt = `
    คุณคือผู้เชี่ยวชาญด้าน OMR (Optical Mark Recognition). 
    วิเคราะห์ภาพ "ต้นแบบเฉลย" (Answer Key) ที่มีจำนวนข้อสอบ ${questionCount} ข้อ.
    
    หน้าที่ของคุณ:
    1. ตรวจหาพิกัด (x, y, w, h เป็น % เทียบกับขนาดภาพ 0-100) ของ "ทุกช่องตัวเลือก" (ก, ข, ค, ง, จ) ในทุกข้อ
    2. วิเคราะห์ว่าในแต่ละข้อ "ช่องตัวเลือกใดที่มีรอยปากกากากบาท (X), รอยฝนดำ, หรือรอยติ๊ก" ซึ่งหมายถึงเฉลยที่ถูกต้อง
    3. สำหรับช่องที่เป็นเฉลย ให้ตั้งค่า "isMarked": true (ห้ามเป็น true ทุกช่องในข้อเดียว)
    4. ตรวจสอบให้ครบตั้งแต่ข้อที่ 1 ถึงข้อที่ ${questionCount} อย่างละเอียด
    
    โครงสร้าง JSON ที่ต้องการ:
    {
      "boxes": [
        { "questionNumber": 1, "optionLabel": "ก", "x": 12.5, "y": 15.0, "w": 2.0, "h": 1.5, "isMarked": true },
        ...
      ]
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
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
    if (!text) throw new Error("AI ไม่ส่งข้อมูลการวิเคราะห์กลับมา");
    
    const jsonStr = extractJson(text);
    const data = JSON.parse(jsonStr);
    
    if (!data.boxes || !Array.isArray(data.boxes)) {
      throw new Error("ข้อมูลที่ AI ส่งกลับมาไม่อยู่ในรูปแบบที่ถูกต้อง");
    }

    const boxes: BoxCoordinate[] = data.boxes.map((b: any, i: number) => ({
      id: `box-${i}`,
      ...b
    }));

    // ดึงค่าเฉลยจากช่องที่ AI ระบุว่า isMarked: true
    const correctAnswers: Record<number, string> = {};
    data.boxes.forEach((b: any) => {
      if (b.isMarked === true) {
        correctAnswers[b.questionNumber] = b.optionLabel;
      }
    });

    return { boxes, correctAnswers };
  } catch (error: any) {
    console.error("Master Sheet Analysis Failed:", error);
    if (error.message?.includes("API key")) {
      throw new Error("API Key ไม่ถูกต้องหรือยังไม่ได้เลือกโปรเจคที่มีการเรียกเก็บเงิน (Billing)");
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
    // วิเคราะห์ความเข้มของสีในช่อง (ลดขอบลง 15% เพื่อเลี่ยงเส้นขอบช่อง)
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
