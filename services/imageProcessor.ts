
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

  // ปรับปรุง Prompt ให้ชัดเจนขึ้น เพื่อให้ AI ตรวจจับทุกช่องคำตอบและระบุว่าช่องไหนคือเฉลย
  const prompt = `
    คุณคือผู้เชี่ยวชาญด้าน OMR (Optical Mark Recognition). วิเคราะห์ภาพกระดาษคำตอบต้นแบบ (Master Answer Key) จำนวน ${questionCount} ข้อ.
    ภารกิจของคุณคือ:
    1. ระบุพิกัด (x, y, w, h เป็น % เทียบกับขนาดภาพเต็ม 0-100) ของ "ทุกช่องคำตอบ" (ก, ข, ค, ง, จ) สำหรับทุกข้อตั้งแต่ข้อ 1 ถึงข้อที่ ${questionCount}.
    2. ตรวจสอบว่าในแต่ละข้อ ช่องคำตอบใด (optionLabel) ที่ครูได้ทำเครื่องหมายเฉลยไว้ (กากบาท, ฝนดำ, หรือวงกลม) ให้ตั้งค่า isMarked: true สำหรับช่องนั้น.
    3. ตรวจสอบให้แน่ใจว่าแต่ละข้อควรมีช่องที่ isMarked: true เพียงช่องเดียว (หากเป็นเฉลยมาตรฐาน).
    4. รายการตัวเลือกคือ "ก", "ข", "ค", "ง", และ "จ".
    
    ส่งผลลัพธ์เป็น JSON ตามโครงสร้างนี้เท่านั้น:
    {
      "boxes": [
        { "questionNumber": 1, "optionLabel": "ก", "x": 10.5, "y": 20.2, "w": 2.5, "h": 2.0, "isMarked": true },
        { "questionNumber": 1, "optionLabel": "ข", "x": 14.5, "y": 20.2, "w": 2.5, "h": 2.0, "isMarked": false },
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
      throw new Error("โครงสร้างข้อมูล JSON ไม่ถูกต้อง");
    }

    const boxes: BoxCoordinate[] = data.boxes.map((b: any, i: number) => ({
      id: `box-${i}`, ...b
    }));

    // สร้างตารางเฉลยที่ถูกต้องจากช่องที่ AI ตรวจพบว่ามาร์คไว้
    const correctAnswers: Record<number, string> = {};
    data.boxes.forEach((b: any) => {
      if (b.isMarked === true) {
        correctAnswers[b.questionNumber] = b.optionLabel;
      }
    });

    return { boxes, correctAnswers };
  } catch (error: any) {
    console.error("Analysis Error:", error);
    if (error.message?.includes("API key")) {
      throw new Error("API Key ไม่ถูกต้องหรือหมดอายุ กรุณาตรวจสอบอีกครั้ง");
    }
    throw new Error("AI วิเคราะห์ภาพล้มเหลว: " + error.message);
  }
};

export const checkInkDensity = (ctx: CanvasRenderingContext2D, box: BoxCoordinate, cw: number, ch: number): number => {
  // การคำนวณตำแหน่งพื้นที่เพื่อตรวจความเข้มของน้ำหมึก (ใช้สำหรับการตรวจกระดาษคำตอบนักเรียน)
  const x = (box.x / 100) * cw;
  const y = (box.y / 100) * ch;
  const w = (box.w / 100) * cw;
  const h = (box.h / 100) * ch;
  
  try {
    // ดึงข้อมูลพิกเซลจากพื้นที่ส่วนกลางของช่อง (70% ของพื้นที่ช่องทั้งหมด)
    const data = ctx.getImageData(x+(w*0.15), y+(h*0.15), w*0.7, h*0.7).data;
    let darkPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      // คำนวณความสว่าง (0-255) ของพิกเซล ถ้าต่ำกว่า 165 ถือว่าเป็นสีเข้ม/รอยดำ
      const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
      if (brightness < 165) darkPixels++;
    }
    // ส่งคืนค่าความหนาแน่น (0.0 - 1.0)
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
