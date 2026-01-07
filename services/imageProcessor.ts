
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
    คำสั่ง: วิเคราะห์ภาพ "กระดาษคำตอบต้นแบบ (เฉลย)" จำนวน ${questionCount} ข้อ

    โครงสร้างกระดาษ:
    - ข้อสอบเรียงจากบนลงล่างตามลำดับข้อ (1, 2, 3, ...)
    - ใน 1 ข้อ จะมีช่องตัวเลือก 4 ช่องเรียงกันใน "แนวระนาบเดียวกัน (แนวนอน)" 
    - ลำดับช่องจากซ้ายไปขวาคือ: ช่องที่ 1 (ก), ช่องที่ 2 (ข), ช่องที่ 3 (ค), และช่องที่ 4 (ง)

    การตรวจจับเฉลย:
    - ในแต่ละแถว (แต่ละข้อ) ให้เปรียบเทียบทั้ง 4 ช่อง
    - ช่องใดที่มี "รอยกากบาท (X)" หรือ "รอยมาร์ค" ที่ชัดเจนกว่าช่องอื่น ให้ถือว่าเป็น "เฉลย"
    - สำหรับช่องที่เป็นเฉลย ให้ระบุ "isMarked": true
    - ทุกข้อ (1 ถึง ${questionCount}) ต้องระบุ "isMarked": true เพียง "หนึ่งช่อง" เท่านั้น

    งานที่ต้องทำ:
    1. ตรวจพิกัด x, y, w, h (หน่วยเป็น %) ของทุกช่อง ก, ข, ค, ง ในทุกข้อ
    2. ระบุว่าช่องใดคือเฉลย (isMarked: true)

    ส่งผลลัพธ์เป็น JSON เท่านั้น
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
        systemInstruction: "คุณคือ AI ผู้เชี่ยวชาญด้านการตรวจกระดาษคำตอบ (OMR) หน้าที่ของคุณคือการมองหา 'รอยกากบาท' ในช่องคำตอบ 4 ช่องที่เรียงกันในแนวนอนเพื่อระบุว่าเป็นตัวเลือก ก, ข, ค หรือ ง และส่งพิกัดพร้อมสถานะเฉลยกลับมาในรูปแบบ JSON ที่ถูกต้องแม่นยำ 100%",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            boxes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionNumber: { type: Type.INTEGER, description: "เลขข้อสอบ" },
                  optionLabel: { type: Type.STRING, description: "ตัวเลือก (ก, ข, ค, ง)" },
                  x: { type: Type.NUMBER, description: "พิกัด X เริ่มต้น (%)" },
                  y: { type: Type.NUMBER, description: "พิกัด Y เริ่มต้น (%)" },
                  w: { type: Type.NUMBER, description: "ความกว้าง (%)" },
                  h: { type: Type.NUMBER, description: "ความสูง (%)" },
                  isMarked: { type: Type.BOOLEAN, description: "เป็นช่องที่มีรอยกากบาทเฉลยหรือไม่" }
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
    if (!text) throw new Error("AI ไม่ตอบสนอง");
    
    const jsonStr = extractJson(text);
    const data = JSON.parse(jsonStr);
    
    if (!data.boxes || !Array.isArray(data.boxes)) {
      throw new Error("ข้อมูล JSON ผิดพลาด");
    }

    const boxes: BoxCoordinate[] = data.boxes.map((b: any, i: number) => ({
      id: `box-${i}`,
      ...b
    }));

    // ดึงเฉลยจากช่องที่ isMarked เป็น true
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
      throw new Error("โควต้า API เต็ม กรุณารอครู่หนึ่งแล้วลองใหม่");
    }
    throw new Error("ไม่สามารถระบุเฉลยได้: " + error.message);
  }
};

export const checkInkDensity = (ctx: CanvasRenderingContext2D, box: BoxCoordinate, cw: number, ch: number): number => {
  const x = (box.x / 100) * cw;
  const y = (box.y / 100) * ch;
  const w = (box.w / 100) * cw;
  const h = (box.h / 100) * ch;
  
  try {
    // โฟกัสไปที่พื้นที่ตรงกลาง 60% ของช่องเพื่อตรวจรอยกากบาท
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
