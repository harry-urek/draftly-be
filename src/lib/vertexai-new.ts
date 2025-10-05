import { VertexAI, SchemaType } from "@google-cloud/vertexai";
import * as fs from "fs/promises";
import * as path from "path";

// Initialize Vertex AI
const vertex_ai = new VertexAI({
  project: process.env.VERTEX_AI_PROJECT_ID || "draftly-473408",
  location: process.env.VERTEX_AI_LOCATION || "us-central1",
});

const generativeModel = vertex_ai.getGenerativeModel({
  model: "gemini-1.5-pro-001",
});

console.log("[AI] Using Vertex AI");

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
        closingStrategy: {
          type: SchemaType.STRING,
          enum: ["Brief", "Warm", "Action-oriented"],
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
 * Generate AI style profile from questionnaire data
 * Uses Vertex AI to analyze user responses and create a comprehensive style profile
 * @param questionnaireData - User's responses to the style questionnaire
 * @returns AI-generated style profile
 */
export async function generateStyleProfile(
  questionnaireData: Record<string, any>
): Promise<any> {
  try {
    // Load the prompt template
    const promptPath = path.join(
      process.cwd(),
      "prompts",
      "style-profile-generation.md"
    );
    const promptTemplate = await fs.readFile(promptPath, "utf-8");

    // Replace placeholder with actual data
    const userResponsesJson = JSON.stringify(questionnaireData, null, 2);
    const finalPrompt = promptTemplate.replace(
      "{{USER_RESPONSES_JSON}}",
      userResponsesJson
    );

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
  } catch (error) {
    console.error("[AI] Failed to generate style profile:", error);
    throw new Error("Failed to generate style profile");
  }
}

/**
 * Generate email draft using the user's style profile
 * Uses Vertex AI to generate email drafts matching the user's writing style
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
  } catch (error) {
    console.error("[AI] Failed to generate email draft:", error);
    throw new Error("Failed to generate email draft");
  }
}

/**
 * Test AI connection and configuration
 * Tests Vertex AI connection
 * @returns Connection status and error details if failed
 */
export async function testVertexAIConnection(): Promise<{
  connected: boolean;
  provider?: string;
  error?: string;
}> {
  try {
    // Test Vertex AI
    console.log("[AI] Testing Vertex AI connection...");

    const projectId = process.env.VERTEX_AI_PROJECT_ID || "draftly-473408";
    const location = process.env.VERTEX_AI_LOCATION || "us-central1";

    // Check environment variables
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

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
  } catch (error: any) {
    console.error("[AI] Vertex AI connection test failed:", error.message);

    // Provide helpful error messages
    let errorMessage = "Unknown error";

    if (error.message?.includes("403")) {
      errorMessage =
        "Permission denied. Check service account has 'Vertex AI User' role or enable billing";
    } else if (error.message?.includes("404")) {
      errorMessage = "API not found. Check project ID and location";
    } else if (error.message?.includes("PERMISSION_DENIED")) {
      errorMessage =
        "API not enabled or lacks permissions. Visit: https://console.developers.google.com/apis/api/aiplatform.googleapis.com";
    } else if (error.code === "ENOENT") {
      errorMessage = "Credentials file not found";
    } else {
      errorMessage = error.message;
    }

    return {
      connected: false,
      provider: "Vertex AI",
      error: errorMessage,
    };
  }
}
