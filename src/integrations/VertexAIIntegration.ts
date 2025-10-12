/* eslint-disable import/no-unresolved */
import { VertexAI, SchemaType } from "@google-cloud/vertexai";

import config from "../config";
import { withAiRateLimit } from "../lib/aiRateLimiter";
import { AIStyleProfile, EmailGenerationContext } from "../types";
import { ExternalServiceError } from "../utils/errors";

// Using a type alias instead of 'any'
type GenerativeAIModel = ReturnType<VertexAI["getGenerativeModel"]>;

export class VertexAIIntegration {
  private vertex_ai: VertexAI;
  private generativeModel: GenerativeAIModel;
  private asyncSleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
  private isTransient(err: unknown): boolean {
    const msg = String((err as Error)?.message || err || "");
    return /(429|RESOURCE_EXHAUSTED|Too Many Requests|UNAVAILABLE)/i.test(msg);
  }
  private async retry<T>(
    fn: () => Promise<T>,
    retries = 3,
    baseDelayMs = 700,
    maxDelayMs = 8000
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (e) {
        attempt++;
        if (!this.isTransient(e) || attempt > retries) throw e;
        const backoff = Math.min(
          maxDelayMs,
          Math.round(baseDelayMs * Math.pow(2, attempt - 1))
        );
        const jitter = Math.round(backoff * (0.8 + Math.random() * 0.4));
        console.warn(
          `[AI] Vertex retry in ${jitter}ms (attempt ${attempt}/${retries})`
        );
        await this.asyncSleep(jitter);
      }
    }
  }

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
      const result = await this.retry(() =>
        withAiRateLimit(() =>
          this.generativeModel.generateContent({
            contents: [{ role: "user", parts: [{ text: testPrompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 10,
            },
          })
        )
      );

      return !!result.response;
    } catch (error) {
      console.error("Vertex AI connection test failed:", error);
      return false;
    }
  }

  async generateStyleProfile(
    questionnaireData: Record<string, unknown>
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

      // lightweight token estimate (chars/4 ≈ tokens); log if too large
      const approxTokens = Math.round(prompt.length / 4);
      if (approxTokens > 6000) {
        console.warn(
          `[AI] Large prompt for style profile (~${approxTokens} tokens). Consider trimming questionnaire input.`
        );
      }

      const result = await this.retry(
        () =>
          withAiRateLimit(() =>
            this.generativeModel.generateContent({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig,
            })
          ),
        4
      );

      const { response } = result;
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

      // lightweight token estimate for email draft prompt
      const approxTokens = Math.round(prompt.length / 4);
      if (approxTokens > 6000) {
        console.warn(
          `[AI] Large draft prompt (~${approxTokens} tokens). Trimming thread history.`
        );
      }

      const result = await this.retry(
        () =>
          withAiRateLimit(() =>
            this.generativeModel.generateContent({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig,
            })
          ),
        4
      );

      const { response } = result;
      const candidate = response.candidates?.[0];
      const content = candidate?.content;
      const part = content?.parts?.[0];

      return part?.text || "";
    } catch (error) {
      throw new ExternalServiceError(
        "Vertex AI",
        `Failed to generate email draft: ${error}`
      );
    }
  }

  private createStyleProfilePrompt(
    questionnaireData: Record<string, unknown>
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
${context.senderName ? `Sender Name: ${context.senderName}` : ""}
${context.senderEmail ? `Sender Email: ${context.senderEmail}` : ""}
${context.senderCompany ? `Sender Company/Firm: ${context.senderCompany}` : ""}
${context.recipientName ? `User's Name (reply author): ${context.recipientName}` : ""}

**INSTRUCTIONS:**
- Write a reply to the original email
- Match the user's writing style EXACTLY as described in the profile
- Use their preferred greetings, closings, tone, and structural patterns
- Maintain their typical sentence complexity and vocabulary level
- Adapt formality based on recipient relationship if specified
- Preserve proper email threading and context
- If senderName is available, begin with an appropriate greeting using their name (e.g., "Hi Sarah,").
- If User's Name or a signature is available, include a natural sign-off that uses it. Do not fabricate a name if none is provided.
- Personalize the body referencing the sender company when natural; avoid placeholders like [Name] or [Company]. Omit unknown details.

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
