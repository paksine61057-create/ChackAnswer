
import { GoogleGenAI, Type } from "@google/genai";
import { BoxCoordinate } from "../types.ts";

/**
 * ฟังก์ชันสกัด JSON ออกจากข้อความของ AI อย่างแม่นยำ
 */
const extractJson = (text: string): string => {
  // ค้นหาข้อความที่อยู่ระหว่าง { ... } หรือ [ ... ]
  const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (match) return match[0];
  return text;
};

/**
 * วิเคราะห์กระดาษคำตอบต้นแบบด้วย AI
 */
export const analyzeMasterSheet = async (base64DataUrl: string): Promise<{ boxes: BoxCoordinate[], correctAnswers: Record<number, string> }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // แยก MIME Type ออกจาก Base64 Data URL (เช่น data:image/png;base64,...)
  const mimeTypeMatch = base64DataUrl.match(/^data:(.*);base64,/);
  const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/jpeg';
  const base64Data = base64DataUrl.replace(/^data:.*;base64,/, '');

  const prompt = `
    คุณคือผู้เชี่ยวชาญด้านระบบตรวจข้อสอบ (OMR Expert). 
    ภารกิจ: วิเคราะห์ภาพกระดาษคำตอบต้นแบบที่แนบมา
    
    1. ตรวจหา "ช่องคำตอบ" ทั้งหมดในกระดาษ (มักเป็นวงกลมหรือสี่เหลี่ยมเล็กๆ)
    2. ระบุตำแหน่ง (x, y, w, h) เป็นเปอร์เซ็นต์ (0-100) เมื่อเทียบกับขนาดภาพทั้งหมด
    3. ตรวจหาช่องที่ "คุณครูกากบาท (X)" หรือ "ระบายสี" เพื่อทำเป็นเฉลย (isMarked: true)
    4. ระบุเลขข้อ (questionNumber) และ ตัวเลือก (optionLabel เช่น ก, ข, ค, ง หรือ A, B, C, D) ให้ถูกต้องตามที่ปรากฏในกระดาษ
    
    ส่งผลลัพธ์เป็น JSON Object ที่มีโครงสร้างดังนี้:
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
        parts: [
          { inlineData: { data: base64Data, mimeType: mimeType } },
          { text: prompt }
        ]
      },
      config: {
        thinkingConfig: { thinkingBudget: 2048 },
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
          },
          required: ['boxes']
        }
      }
    });

    const rawText = response.text || '{}';
    const cleanedText = extractJson(rawText);
    const data = JSON.parse(cleanedText);
    
    if (!data.boxes || !Array.isArray(data.boxes) || data.boxes.length === 0) {
      throw new Error("AI ตรวจไม่พบช่องคำตอบในภาพ กรุณาตรวจสอบว่าภาพไม่มืดหรือเบลอเกินไป");
    }

    const boxes: BoxCoordinate[] = data.boxes.map((b: any, index: number) => ({
      id: `box-${index}`,
      questionNumber: b.questionNumber,
      optionLabel: b.optionLabel,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h
    }));

    const correctAnswers: Record<number, string> = {};
    data.boxes.forEach((b: any) => {
      if (b.isMarked) {
        correctAnswers[b.questionNumber] = b.optionLabel;
      }
    });

    return { boxes, correctAnswers };
  } catch (error: any) {
    console.error("AI Analysis Error:", error);
    throw new Error(error.message || "การสื่อสารกับ AI ขัดข้อง");
  }
};

/**
 * ตรวจสอบความหนาแน่นของรอยปากกาในแต่ละช่อง
 */
export const checkInkDensity = (
  ctx: CanvasRenderingContext2D,
  box: BoxCoordinate,
  canvasWidth: number,
  canvasHeight: number
): number => {
  const x = (box.x / 100) * canvasWidth;
  const y = (box.y / 100) * canvasHeight;
  const w = (box.w / 100) * canvasWidth;
  const h = (box.h / 100) * canvasHeight;

  // ตัดขอบช่องคำตอบออก 15% เพื่อป้องกันการนับเส้นขอบเป็นรอยปากกา
  const padding = 0.15;
  const safeX = x + (w * padding);
  const safeY = y + (h * padding);
  const safeW = w * (1 - (padding * 2));
  const safeH = h * (1 - (padding * 2));

  try {
    const imageData = ctx.getImageData(
      Math.max(0, safeX), 
      Math.max(0, safeY), 
      Math.max(1, safeW), 
      Math.max(1, safeH)
    );
    const data = imageData.data;
    let darkPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (brightness < 165) darkPixels++;
    }

    return darkPixels / (safeW * safeH);
  } catch (e) {
    return 0;
  }
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};
