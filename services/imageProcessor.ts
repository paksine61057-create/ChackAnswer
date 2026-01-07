
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
  // ดึงค่าล่าสุดจาก process.env (ซึ่งอาจถูก shim ไว้ใน window)
  const apiKey = (process.env.API_KEY || (window as any).process?.env?.API_KEY) as string;
  
  // ตรวจสอบความพร้อมของ Key ก่อนส่งให้ SDK เพื่อป้องกัน Error: An API Key must be set
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("กรุณากรอก API Key ในช่องตั้งค่าก่อนเริ่มการประมวลผล");
  }

  // สร้าง Instance ใหม่ทุกครั้งเพื่อให้มั่นใจว่าใช้ Key ล่าสุด
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const base64Data = base64DataUrl.replace(/^data:.*;base64,/, '');

  const prompt = `
    คุณคือผู้เชี่ยวชาญด้าน OMR. วิเคราะห์ภาพกระดาษคำตอบต้นแบบที่มีจำนวนข้อสอบทั้งหมด ${questionCount} ข้อ.
    1. หาช่องคำตอบทั้งหมด (x, y, w, h เป็น % 0-100)
    2. หาช่องที่ครูกากบาทเฉลยไว้ (isMarked: true) 
    3. ตรวจสอบให้ครบทุกข้อตั้งแต่ข้อ 1 ถึง ${questionCount}
    
    ส่งผลลัพธ์เป็น JSON:
    {
      "boxes": [
        { "questionNumber": 1, "optionLabel": "ก", "x": 10.5, "y": 20.2, "w": 2.1, "h": 1.5, "isMarked": true },
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

    const data = JSON.parse(extractJson(response.text || '{}'));
    const boxes: BoxCoordinate[] = data.boxes.map((b: any, i: number) => ({
      id: `box-${i}`, ...b
    }));

    const correctAnswers: Record<number, string> = {};
    data.boxes.forEach((b: any) => {
      if (b.isMarked) correctAnswers[b.questionNumber] = b.optionLabel;
    });

    return { boxes, correctAnswers };
  } catch (error: any) {
    if (error.message?.includes("API key")) {
      throw new Error("API Key ไม่ถูกต้องหรือหมดอายุ กรุณาตรวจสอบอีกครั้ง");
    }
    throw new Error("AI วิเคราะห์ภาพล้มเหลว: " + error.message);
  }
};

export const checkInkDensity = (ctx: CanvasRenderingContext2D, box: BoxCoordinate, cw: number, ch: number): number => {
  const x = (box.x / 100) * cw;
  const y = (box.y / 100) * ch;
  const w = (box.w / 100) * cw;
  const h = (box.h / 100) * ch;
  try {
    const data = ctx.getImageData(x+(w*0.15), y+(h*0.15), w*0.7, h*0.7).data;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] + data[i+1] + data[i+2]) / 3 < 165) dark++;
    }
    return dark / (w*0.7 * h*0.7);
  } catch { return 0; }
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((r, j) => {
    const rd = new FileReader();
    rd.readAsDataURL(file);
    rd.onload = () => r(rd.result as string);
    rd.onerror = e => j(e);
  });
};
