
export interface BoxCoordinate {
  id: string;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  w: number;
  h: number;
  questionNumber: number;
  optionLabel: string; // 'ก', 'ข', 'ค', 'ง'
}

export interface MasterConfig {
  imageUrl: string;
  boxes: BoxCoordinate[];
  correctAnswers: Record<number, string>; // questionNumber -> optionLabel
}

export interface GradingResult {
  studentId: string;
  score: number;
  total: number;
  details: {
    question: number;
    studentAnswer: string | null;
    correctAnswer: string;
    isCorrect: boolean;
    isWarning: boolean; // multiple marks, etc.
  }[];
  timestamp: number;
}
