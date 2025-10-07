import { VertexAI, SchemaType } from "@google-cloud/vertexai";
import config from "../config/index.js";
import { AIStyleProfile, EmailGenerationContext } from "../types/index.js";
import { ExternalServiceError } from "../utils/errors.js";

export class VertexAIIntegration {
  private vertex_ai: VertexAI;
  private generativeModel: any;

  constructor() {
    this.vertex_ai = new VertexAI({
      project: config.vertexAiProjectId,
      location: config.vertexAiLocation,
    });

    this.generativeModel = this.vertex_ai.getGenerativeModel({
      model: "gemini-2.0-flash-001",
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const testPrompt = "Say 'Hello' in one word.";
      const result = await this.generativeModel.generateContent({
        contents: [{ role: "user", parts: [{ text: testPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 10,
        },
      });

      return !!result.response;
    } catch (error) {
      console.error("Vertex AI connection test failed:", error);
      return false;
    }
  }

  async generateStyleProfile(
    questionnaireData: Record<string, any>
  ): Promise<AIStyleProfile> {
    try {
      const prompt = this.createStyleProfilePrompt(questionnaireData);

      const generationConfig = {
        temperature: 0.3,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema: this.getStyleProfileSchema(),
      };

      const result = await this.generativeModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      });

      const response = result.response;
      const candidate = response.candidates?.[0];
      const content = candidate?.content;
      const part = content?.parts?.[0];
      const profileJson = part?.text || "{}";

      return JSON.parse(profileJson);
    } catch (error) {
      throw new ExternalServiceError(
        "Vertex AI",
        `Failed to generate style profile: ${error}`
      );
    }
  }

  async generateEmailDraft(
    styleProfile: AIStyleProfile,
    context: EmailGenerationContext
  ): Promise<string> {
    try {
      const prompt = this.createEmailDraftPrompt(styleProfile, context);

      const generationConfig = {
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 1024,
      };

      const result = await this.generativeModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      });

      const response = result.response;
      const candidate = response.candidates?.[0];
      const content = candidate?.content;
      const part = content?.parts?.[0];
      const draft = part?.text || "";

      return draft;
    } catch (error) {
      throw new ExternalServiceError(
        "Vertex AI",
        `Failed to generate email draft: ${error}`
      );
    }
  }

  private createStyleProfilePrompt(
    questionnaireData: Record<string, any>
  ): string {
    return `
Analyze the following user questionnaire responses and generate a comprehensive AI writing style profile.

User Responses:
${JSON.stringify(questionnaireData, null, 2)}

Generate a detailed style profile that captures:
1. Primary and secondary tone preferences
2. Formality level and flexibility
3. Structural preferences (greetings, closings, paragraph style)
4. Vocabulary and language usage
5. Communication approach and directness
6. Contextual adaptation preferences

Return the analysis as a structured JSON object following the specified schema.
    `.trim();
  }

  private createEmailDraftPrompt(
    styleProfile: AIStyleProfile,
    context: EmailGenerationContext
  ): string {
    return `
You are an AI email assistant that writes emails in the exact style of a specific user.

**USER'S WRITING STYLE PROFILE:**
${JSON.stringify(styleProfile, null, 2)}

**EMAIL CONTEXT:**
Original Email: ${context.originalEmail}
${
  context.threadHistory
    ? `Thread History: ${context.threadHistory.join("\n---\n")}`
    : ""
}
${context.tone ? `Requested Tone: ${context.tone}` : ""}
${
  context.recipient
    ? `Recipient: ${context.recipient.name} (${context.recipient.email}) - ${context.recipient.relationship}`
    : ""
}

**INSTRUCTIONS:**
- Write a reply to the original email
- Match the user's writing style EXACTLY as described in the profile
- Use their preferred greetings, closings, tone, and structural patterns
- Maintain their typical sentence complexity and vocabulary level
- Adapt formality based on recipient relationship if specified
- Preserve proper email threading and context

Generate the email draft now:
    `.trim();
  }

  private getStyleProfileSchema() {
    return {
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
            formalityScore: {
              type: SchemaType.INTEGER,
              minimum: 1,
              maximum: 5,
            },
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
              enum: [
                "Direct to point",
                "Warm greeting first",
                "Context setting",
              ],
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
  }
}
