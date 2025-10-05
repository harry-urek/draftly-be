import { VertexAI, SchemaType } from "@google-cloud/vertexai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs/promises";
import * as path from "path";

// Determine which AI provider to use
const USE_GEMINI_API = !!process.env.GEMINI_API_KEY;

// Initialize Vertex AI (if not using Gemini API)
let vertex_ai: VertexAI | null = null;
let generativeModel: any = null;

if (!USE_GEMINI_API) {
  vertex_ai = new VertexAI({
    project: process.env.VERTEX_AI_PROJECT_ID || "draftly-473408",
    location: process.env.VERTEX_AI_LOCATION || "us-central1",
  });
  generativeModel = vertex_ai.getGenerativeModel({
    model: "gemini-1.5-pro-001",
  });
}

// Initialize Google AI Studio (Gemini API) as fallback
let geminiModel: any = null;
if (USE_GEMINI_API) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro-002" });
  console.log("[AI] Using Google AI Studio (Gemini API)");
} else {
  console.log("[AI] Using Vertex AI");
}

// Define the JSON schema for the AI style profile
const STYLE_PROFILE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    toneAndFormality: {
      type: SchemaType.OBJECT,
      properties: {
        primaryTone: {
          type: SchemaType.STRING,
          enum: [
            "Friendly",
            "Formal",
            "Direct",
            "Diplomatic",
            "Casual",
            "Professional",
          ],
        },
        secondaryTone: {
          type: SchemaType.STRING,
          enum: [
            "Friendly",
            "Formal",
            "Direct",
            "Diplomatic",
            "Casual",
            "Professional",
            "null",
          ],
        },
        formalityScore: { type: SchemaType.INTEGER, minimum: 1, maximum: 5 },
        toneFlexibility: {
          type: SchemaType.STRING,
          enum: ["Rigid", "Moderate", "Highly Adaptive"],
        },
      },
      required: ["primaryTone", "formalityScore", "toneFlexibility"],
    },
    structuralPreferences: {
      type: SchemaType.OBJECT,
      properties: {
        greetingStyle: {
          type: SchemaType.OBJECT,
          properties: {
            newContact: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
            colleague: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
            manager: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
          },
        },
        closingStyle: {
          type: SchemaType.OBJECT,
          properties: {
            formal: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
            casual: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
          },
        },
        sentenceComplexity: {
          type: SchemaType.STRING,
          enum: ["Simple", "Moderate", "Complex"],
        },
        paragraphLength: {
          type: SchemaType.STRING,
          enum: [
            "Short (1-2 sentences)",
            "Medium (3-4 sentences)",
            "Long (5+ sentences)",
          ],
        },
        useOfFormatting: {
          type: SchemaType.STRING,
          enum: ["Minimal", "Moderate", "Heavy (bullet points, bolding)"],
        },
        prefersBulletPoints: { type: SchemaType.BOOLEAN },
      },
    },
    lexicalFeatures: {
      type: SchemaType.OBJECT,
      properties: {
        vocabularyLevel: {
          type: SchemaType.STRING,
          enum: ["Simple", "Moderate", "Advanced", "Technical"],
        },
        emojiUsage: {
          type: SchemaType.STRING,
          enum: ["Never", "Rare", "Occasional", "Frequent"],
        },
        commonPhrases: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
        },
        fillerWords: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
        },
        technicalJargon: {
          type: SchemaType.STRING,
          enum: ["Low", "Medium", "High"],
        },
      },
    },
    communicationProfile: {
      type: SchemaType.OBJECT,
      properties: {
        orientation: {
          type: SchemaType.STRING,
          enum: ["Task-Oriented", "Relationship-Oriented", "Balanced"],
        },
        directness: {
          type: SchemaType.STRING,
          enum: ["Very Direct", "Moderate", "Diplomatic"],
        },
        responsivenessStyle: {
          type: SchemaType.STRING,
          enum: [
            "Immediate and Brief",
            "Thoughtful and Detailed",
            "Contextual",
          ],
        },
        conflictHandling: {
          type: SchemaType.STRING,
          enum: ["Apologetic", "Solution-Focused", "Empathetic", "Direct"],
        },
      },
    },
    contextualAdaptation: {
      type: SchemaType.OBJECT,
      properties: {
        formalityRangeByAudience: {
          type: SchemaType.OBJECT,
          properties: {
            colleague: { type: SchemaType.INTEGER, minimum: 1, maximum: 5 },
            client: { type: SchemaType.INTEGER, minimum: 1, maximum: 5 },
            manager: { type: SchemaType.INTEGER, minimum: 1, maximum: 5 },
          },
        },
        lengthVariationByContext: {
          type: SchemaType.OBJECT,
          properties: {
            simpleRequest: {
              type: SchemaType.STRING,
              enum: ["1-2 sentences", "3-5 sentences", "Full paragraph"],
            },
            apology: {
              type: SchemaType.STRING,
              enum: ["Brief", "Moderate", "Detailed"],
            },
            refusal: {
              type: SchemaType.STRING,
              enum: ["Direct", "Softened", "Alternative-Focused"],
            },
          },
        },
      },
    },
    writingHabits: {
      type: SchemaType.OBJECT,
      properties: {
        petPeeves: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
        },
        signatureElements: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
        },
        openingStrategy: {
          type: SchemaType.STRING,
          enum: ["Direct to point", "Warm greeting first", "Context setting"],
        },
      },
    },
  },
  required: [
    "toneAndFormality",
    "structuralPreferences",
    "lexicalFeatures",
    "communicationProfile",
    "contextualAdaptation",
    "writingHabits",
  ],
};

/**
 * Generate AI style profile from questionnaire responses
 * Uses Vertex AI if configured, falls back to Gemini API
 * @param questionnaireData - User's questionnaire responses
 * @returns Generated style profile as JSON
 */
export async function generateStyleProfile(
  questionnaireData: any
): Promise<any> {
  try {
    // Load the prompt template
    const promptPath = path.join(
      process.cwd(),
      "prompts",
      "style-profile-generation.md"
    );
    let promptTemplate = await fs.readFile(promptPath, "utf-8");

    // Inject user responses into the prompt
    const userResponsesJson = JSON.stringify(questionnaireData, null, 2);
    const finalPrompt = promptTemplate.replace(
      "{{USER_RESPONSES_JSON}}",
      userResponsesJson
    );

    if (USE_GEMINI_API && geminiModel) {
      // Use Google AI Studio (Gemini API) - simpler, no billing required
      console.log("[AI] Generating style profile with Gemini API...");

      const result = await geminiModel.generateContent({
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          topP: 0.8,
          topK: 40,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      });

      const response = await result.response;
      const profileJson = response.text() || "{}";

      console.log("[AI] Style profile generated successfully (Gemini API)");

      // Parse and return
      return JSON.parse(profileJson);
    } else if (generativeModel) {
      // Use Vertex AI
      console.log("[AI] Generating style profile with Vertex AI...");

      // Configure generation with JSON schema enforcement
      const generationConfig = {
        temperature: 0.3,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema: STYLE_PROFILE_SCHEMA,
      };

      // Generate content
      const result = await generativeModel.generateContent({
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
        generationConfig,
      });

      const response = result.response;
      const candidate = response.candidates?.[0];
      const content = candidate?.content;
      const part = content?.parts?.[0];
      const profileJson = part?.text || "{}";

      console.log("[AI] Style profile generated successfully (Vertex AI)");

      // Parse and return
      return JSON.parse(profileJson);
    } else {
      throw new Error(
        "No AI provider configured. Set GEMINI_API_KEY or configure Vertex AI."
      );
    }
  } catch (error) {
    console.error("[AI] Failed to generate style profile:", error);
    throw new Error("Failed to generate AI style profile");
  }
}

/**
 * Generate email draft using the user's style profile
 * Uses Vertex AI if configured, falls back to Gemini API
 * @param styleProfile - User's AI style profile
 * @param emailContext - Context for the email (original email, thread, etc.)
 * @param tone - Desired tone for the draft
 * @returns Generated email draft
 */
export async function generateEmailDraft(
  styleProfile: any,
  emailContext: {
    originalEmail: string;
    threadHistory?: string[];
    tone?: string;
  },
  userPreferences?: {
    signature?: string;
  }
): Promise<string> {
  try {
    const prompt = `
You are an AI email assistant that writes emails in the exact style of a specific user.

**USER'S WRITING STYLE PROFILE:**
${JSON.stringify(styleProfile, null, 2)}

**EMAIL CONTEXT:**
Original Email: ${emailContext.originalEmail}
${
  emailContext.threadHistory
    ? `Thread History: ${emailContext.threadHistory.join("\n---\n")}`
    : ""
}

**INSTRUCTIONS:**
- Write a reply to the original email
- Match the user's writing style EXACTLY as described in the profile
- Use their preferred greetings, closings, tone, and structural patterns
- Maintain their typical sentence complexity and vocabulary level
- ${
      emailContext.tone
        ? `Adjust the tone to be: ${emailContext.tone}`
        : "Use the user's default tone"
    }
- ${
      userPreferences?.signature
        ? `Include this signature: ${userPreferences.signature}`
        : ""
    }
- Preserve proper email threading and context

Generate the email draft now:
    `.trim();

    const generationConfig = {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 1024,
    };

    if (USE_GEMINI_API && geminiModel) {
      // Use Gemini API
      console.log("[AI] Generating email draft with Gemini API...");

      const result = await geminiModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      });

      const response = await result.response;
      const draft = response.text() || "";

      console.log("[AI] Email draft generated successfully (Gemini API)");
      return draft;
    } else if (generativeModel) {
      // Use Vertex AI
      console.log("[AI] Generating email draft with Vertex AI...");

      const result = await generativeModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      });

      const response = result.response;
      const candidate = response.candidates?.[0];
      const content = candidate?.content;
      const part = content?.parts?.[0];
      const draft = part?.text || "";

      console.log("[AI] Email draft generated successfully (Vertex AI)");
      return draft;
    } else {
      throw new Error(
        "No AI provider configured. Set GEMINI_API_KEY or configure Vertex AI."
      );
    }
  } catch (error) {
    console.error("[AI] Failed to generate email draft:", error);
    throw new Error("Failed to generate email draft");
  }
}

/**
 * Test AI connection and configuration
 * Tests Vertex AI if configured, otherwise tests Gemini API
 * @returns Connection status and error details if failed
 */
export async function testVertexAIConnection(): Promise<{
  connected: boolean;
  provider?: string;
  error?: string;
}> {
  try {
    if (USE_GEMINI_API && geminiModel) {
      // Test Gemini API
      console.log("[AI] Testing Gemini API connection...");

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return {
          connected: false,
          error: "GEMINI_API_KEY not set in environment",
        };
      }

      // Try a simple API call
      const testPrompt = "Say 'Hello' in one word.";
      const result = await geminiModel.generateContent(testPrompt);
      const response = await result.response;

      if (!response) {
        return {
          connected: false,
          provider: "Gemini API",
          error: "No response from Gemini API",
        };
      }

      console.log("[AI] ✓ Gemini API connection successful");
      console.log("[AI] Model: gemini-1.5-pro");

      return { connected: true, provider: "Gemini API" };
    } else if (generativeModel) {
      // Test Vertex AI
      console.log("[AI] Testing Vertex AI connection...");

      // Check environment variables
      const projectId = process.env.VERTEX_AI_PROJECT_ID;
      const location = process.env.VERTEX_AI_LOCATION;
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

      if (!projectId) {
        return {
          connected: false,
          provider: "Vertex AI",
          error: "VERTEX_AI_PROJECT_ID not set in environment",
        };
      }

      if (!location) {
        return {
          connected: false,
          provider: "Vertex AI",
          error: "VERTEX_AI_LOCATION not set in environment",
        };
      }

      if (!credentialsPath) {
        return {
          connected: false,
          provider: "Vertex AI",
          error: "GOOGLE_APPLICATION_CREDENTIALS not set in environment",
        };
      }

      // Check if credentials file exists
      try {
        await fs.access(credentialsPath);
      } catch {
        return {
          connected: false,
          provider: "Vertex AI",
          error: `Credentials file not found at: ${credentialsPath}`,
        };
      }

      // Try a simple API call to test connectivity
      const testPrompt = "Say 'Hello' in one word.";
      const result = await generativeModel.generateContent({
        contents: [{ role: "user", parts: [{ text: testPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 10,
        },
      });

      const response = result.response;
      if (!response) {
        return {
          connected: false,
          provider: "Vertex AI",
          error: "No response from Vertex AI API",
        };
      }

      console.log("[AI] ✓ Vertex AI connection successful");
      console.log(`[AI] Project: ${projectId}`);
      console.log(`[AI] Location: ${location}`);
      console.log(`[AI] Model: gemini-1.5-pro-001`);

      return { connected: true, provider: "Vertex AI" };
    } else {
      return {
        connected: false,
        error:
          "No AI provider configured. Set GEMINI_API_KEY or configure Vertex AI (VERTEX_AI_PROJECT_ID, VERTEX_AI_LOCATION, GOOGLE_APPLICATION_CREDENTIALS)",
      };
    }
  } catch (error: any) {
    const provider = USE_GEMINI_API ? "Gemini API" : "Vertex AI";
    console.error(`[AI] ${provider} connection test failed:`, error.message);

    // Provide helpful error messages
    let errorMessage = "Unknown error";

    if (error.message?.includes("403")) {
      if (USE_GEMINI_API) {
        errorMessage = "Invalid API key or API not enabled";
      } else {
        errorMessage =
          "Permission denied. Check service account has 'Vertex AI User' role or enable billing";
      }
    } else if (error.message?.includes("404")) {
      errorMessage = "API not found. Check project ID and location";
    } else if (error.message?.includes("PERMISSION_DENIED")) {
      errorMessage =
        "API not enabled or lacks permissions. Visit: https://console.developers.google.com/apis/api/aiplatform.googleapis.com";
    } else if (error.message?.includes("API_KEY_INVALID")) {
      errorMessage = "Invalid Gemini API key";
    } else if (error.code === "ENOENT") {
      errorMessage = "Credentials file not found";
    } else {
      errorMessage = error.message;
    }

    return {
      connected: false,
      provider,
      error: errorMessage,
    };
  }
}
