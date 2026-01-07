
import { GoogleGenAI, Type } from "@google/genai";
import { BoxCoordinate } from "../types";

/**
 * Uses Gemini to learn the structure of the answer sheet from the Master image.
 * It identifies where the question boxes are located.
 */
export const analyzeMasterSheet = async (base64Image: string): Promise<{ boxes: BoxCoordinate[], correctAnswers: Record<number, string> }> => {
  // Create instance right before API call to ensure current API key is used
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    Analyze this school answer sheet. 
    1. Identify all answer checkboxes (e.g., choices for multiple-choice questions).
    2. The teacher has marked the correct answers with a cross (X) or similar mark.
    3. Return a JSON list of all checkboxes found.
    4. For each checkbox, provide: question number, option label (e.g., A, B, C, D or ก, ข, ค, ง), and its bounding box as percentages (x, y, width, height relative to image).
    5. Also identify which options are marked as correct.
  `;

  // Using gemini-3-flash-preview as it is the recommended model for basic vision/text tasks.
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
                x: { type: Type.NUMBER, description: 'Percentage from left 0-100' },
                y: { type: Type.NUMBER, description: 'Percentage from top 0-100' },
                w: { type: Type.NUMBER, description: 'Width percentage' },
                h: { type: Type.NUMBER, description: 'Height percentage' },
                isMarked: { type: Type.BOOLEAN, description: 'True if this is a correct answer marked by teacher' }
              },
              required: ['questionNumber', 'optionLabel', 'x', 'y', 'w', 'h', 'isMarked']
            }
          }
        },
        required: ['boxes']
      }
    }
  });

  const responseText = response.text || '{}';
  const data = JSON.parse(responseText.trim());
  const boxesData = data.boxes || [];

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
};

/**
 * Calculates pixel density in a specific area to detect ink.
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

  // Safety boundaries
  const safeX = Math.max(0, Math.min(x, canvasWidth - 1));
  const safeY = Math.max(0, Math.min(y, canvasHeight - 1));
  const safeW = Math.max(1, Math.min(w, canvasWidth - safeX));
  const safeH = Math.max(1, Math.min(h, canvasHeight - safeY));

  const imageData = ctx.getImageData(safeX, safeY, safeW, safeH);
  const data = imageData.data;
  let darkPixels = 0;

  // Simple thresholding: check how many pixels are dark
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const brightness = (r + g + b) / 3;
    if (brightness < 160) { // Threshold for "dark" ink
      darkPixels++;
    }
  }

  return darkPixels / (safeW * safeH);
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
