// User related types
export interface User {
  id: string;
  firebaseUid: string;
  email: string;
  name?: string;
  picture?: string;
  onboardingStatus: OnboardingStatus;
  createdAt: Date;
  updatedAt: Date;
  lastActive: Date;
  isOnline: boolean;
}

export type OnboardingStatus =
  | "NOT_STARTED"
  | "GMAIL_CONNECTED"
  | "QUESTIONNAIRE_IN_PROGRESS"
  | "QUESTIONNAIRE_COMPLETED"
  | "PROFILE_GENERATING"
  | "PROFILE_ERROR"
  | "COMPLETED_INIT_PROFILE"
  | "PROFILE_DONE"
  | "ACTIVE";

// Auth related types
export interface AuthTokens {
  accessToken?: string;
  refreshToken?: string;
}

export interface FirebaseUser {
  firebaseUid: string;
  email: string;
  name?: string;
  picture?: string;
}

// Email related types
export interface EmailMessage {
  id: string;
  gmailId: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  htmlBody?: string;
  timestamp: Date;
  isUnread: boolean;
}

export interface EmailThread {
  id: string;
  gmailId: string;
  subject: string;
  messages: EmailMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailDraft {
  id: string;
  threadId: string;
  content: string;
  tone?: string;
  status: DraftStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type DraftStatus = "PENDING" | "SENT" | "FAILED";

// AI Style Profile types
export interface AIStyleProfile {
  toneAndFormality: {
    primaryTone: string;
    secondaryTone?: string;
    formalityScore: number;
    toneFlexibility: string;
  };
  structuralPreferences: {
    greetingStyle: {
      newContact: string[];
      colleague: string[];
      manager: string[];
    };
    closingStyle: {
      formal: string[];
      casual: string[];
    };
    sentenceComplexity: string;
    paragraphLength: string;
    useOfFormatting: string;
    prefersBulletPoints: boolean;
  };
  lexicalFeatures: {
    vocabularyLevel: string;
    emojiUsage: string;
    commonPhrases: string[];
    fillerWords: string[];
    technicalJargon: string;
  };
  communicationProfile: {
    orientation: string;
    directness: string;
    responsivenessStyle: string;
    conflictHandling: string;
  };
  contextualAdaptation: {
    formalityRangeByAudience: {
      colleague: number;
      client: number;
      manager: number;
    };
    lengthVariationByContext: {
      simpleRequest: string;
      apology: string;
      refusal: string;
    };
  };
  writingHabits: {
    petPeeves: string[];
    signatureElements: string[];
    openingStrategy: string;
    closingStrategy: string;
  };
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T> {
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Service layer types
export interface ServiceResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Gmail API types
export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  body?: string;
  htmlBody?: string;
  isUnread: boolean;
  messageIdHeader?: string;
  references?: string;
}

// Email generation context
export interface EmailGenerationContext {
  originalEmail: string;
  threadHistory?: string[];
  tone?: string;
  recipient?: {
    name?: string;
    email: string;
    relationship?: "colleague" | "client" | "manager" | "other";
  };
}
