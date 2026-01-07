
import { GoogleGenAI, Type } from "@google/genai";
import { BoxCoordinate } from "../types.ts";

/**
 * ฟังก์ชันล้างข้อความที่ไม่ใช่ JSON ออกจากคำตอบของ AI (เช่น Markdown code blocks)
 */
const cleanJsonResponse = (text: string): string => {
  const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  return jsonMatch ? jsonMatch[0] : text;
};

/**
 * วิเคราะห์กระดาษคำตอบต้นแบบเพื่อหาตำแหน่งช่องและเฉลยที่ถูกต้อง
 */
export const analyzeMasterSheet = async (base64Image: string): Promise<{ boxes: BoxCoordinate[], correctAnswers: Record<number, string> }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    Analyze this school answer sheet image carefully.
    Tasks:
    1. Identify EVERY single answer checkbox/bubble intended for student options.
    2. Specifically find the marks (like 'X', checkmarks, or filled circles) made by the teacher to indicate the CORRECT answers.
    3. For each checkbox found, determine its:
       - questionNumber (e.g., 1, 2, 3...)
       - optionLabel (e.g., ก, ข, ค, ง or A, B, C...)
       - bounding box as percentages of the image size (x, y, w, h).
    4. Set "isMarked" to true ONLY if the teacher has marked that specific box as the correct answer.

    Return ONLY a JSON object with a "boxes" array.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
          { text: prompt }
        ]
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
          },
          required: ['boxes']
        }
      }
    });

    const rawText = response.text || '{}';
    const cleanedText = cleanJsonResponse(rawText);
    const data = JSON.parse(cleanedText);
    const boxesData = data.boxes || [];

    if (boxesData.length === 0) {
      throw new Error("AI could not find any answer boxes in the image.");
    }

    const boxes: BoxCoordinate[] = boxesData.map((b: any, index: number) => ({
      id: `box-${index}`,
      questionNumber: b.questionNumber,
      optionLabel: b.optionLabel,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h
    }));

    const correctAnswers: Record<number, string> = {};
    boxesData.forEach((b: any) => {
      if (b.isMarked) {
        correctAnswers[b.questionNumber] = b.optionLabel;
      }
    });

    return { boxes, correctAnswers };
  } catch (error) {
    console.error("AI Analysis Error:", error);
    throw error;
  }
};

/**
 * คำนวณความหนาแน่นของหมึกในพื้นที่ที่กำหนด
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

  const safeX = Math.max(0, Math.min(x, canvasWidth - 1));
  const safeY = Math.max(0, Math.min(y, canvasHeight - 1));
  const safeW = Math.max(1, Math.min(w, canvasWidth - safeX));
  const safeH = Math.max(1, Math.min(h, canvasHeight - safeY));

  try {
    const imageData = ctx.getImageData(safeX, safeY, safeW, safeH);
    const data = imageData.data;
    let darkPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;
      // ปรับค่าความมืด (Threshold) ให้เหมาะกับสีปากกามากขึ้น
      if (brightness < 170) { 
        darkPixels++;
      }
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
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
};
