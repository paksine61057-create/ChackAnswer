
export interface BoxCoordinate {
  id: string;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  w: number;
  h: number;
  questionNumber: number;
  optionLabel: string;
}

export interface SubjectInfo {
  name: string;
  questionCount: number;
}

export interface MasterConfig {
  imageUrl: string;
  boxes: BoxCoordinate[];
  correctAnswers: Record<number, string>;
}

export interface GradingResult {
  studentId: string; // เลขที่
  studentName: string; // ชื่อ-นามสกุล
  score: number;
  total: number;
  details: {
    question: number;
    // Fix: Using string instead of string | null to match grading logic and compiler expectations
    studentAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    isWarning: boolean;
  }[];
  timestamp: number;
}
