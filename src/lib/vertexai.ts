/* eslint-disable import/no-unresolved */
/* eslint-disable import/order */
import * as fs from "fs/promises";
import * as path from "path";

import { VertexAI, SchemaType } from "@google-cloud/vertexai";

// Internal types and utils
import type { AIStyleProfile } from "../types";
import { withAiRateLimit } from "./aiRateLimiter";
import { withRetry } from "./aiRetry";

// Initialize Vertex AI
const vertex_ai = new VertexAI({
  project: process.env.VERTEX_AI_PROJECT_ID || "draftly-4572a",
  location: process.env.VERTEX_AI_LOCATION || "us-central1",
});

const generativeModel = vertex_ai.getGenerativeModel({
  model: "gemini-2.0-flash-001",
});

console.warn("[AI] Using Vertex AI");

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
  questionnaireData: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    // Load the prompt template
    const promptPath = path.join(
      process.cwd(),
      "prompts",
      "style-profile-generation.md"
    );
    let promptTemplate = "";
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      promptTemplate = await fs.readFile(promptPath, "utf-8");
    } catch {
      // Fallback minimal prompt if file is not present in runtime
      promptTemplate = `Analyze the following questionnaire responses and generate a JSON style profile that matches the provided schema.\n\n{{USER_RESPONSES_JSON}}`;
    }

    // Replace placeholder with actual data
    const userResponsesJson = JSON.stringify(questionnaireData, null, 2);
    const finalPrompt = promptTemplate.replace(
      "{{USER_RESPONSES_JSON}}",
      userResponsesJson
    );

    // Use Vertex AI
    console.warn("[AI] Generating style profile with Vertex AI...");

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
    const approxTokens = Math.round(finalPrompt.length / 4);
    if (approxTokens > 6000) {
      console.warn(
        `[AI] Large style profile prompt (~${approxTokens} tokens). Consider trimming questionnaire data.`
      );
    }
    const result = await withRetry(
      () =>
        withAiRateLimit(() =>
          generativeModel.generateContent({
            contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
            generationConfig,
          })
        ),
      { retries: 4, baseDelayMs: 700, maxDelayMs: 9000 }
    );

    const response = result.response;
    const candidate = response.candidates?.[0];
    const content = candidate?.content;
    const part = content?.parts?.[0];
    const profileJson = part?.text || "{}";

    console.warn("[AI] Style profile generated successfully (Vertex AI)");

    // Parse and return
    return JSON.parse(profileJson);
  } catch (error) {
    console.error("[AI] Failed to generate style profile:", error);
    throw new Error("Failed to generate style profile");
  }
}

/**
 * PROSE-inspired persona generation pipeline
 * Implements:
 * 1) Initial stylometric analysis over scenario responses to create a hypothesis
 * 2) Iterative refinement per scenario: generate -> compare -> refine (2 loops)
 * 3) Consistency verification across scenarios
 * 4) Final synthesis into STYLE_PROFILE_SCHEMA
 */
export async function generatePersonaProfilePROSE(
  questionnaire: unknown
): Promise<AIStyleProfile> {
  // Extract scenario responses regardless of payload shape
  const scenarios: Array<{
    id: string;
    prompt?: string;
    response: string;
  }> = extractScenarioResponses(questionnaire) as Array<{
    id: string;
    prompt?: string;
    response: string;
  }>;

  if (!scenarios.length) {
    throw new Error("No scenario responses provided");
  }

  // Step 1: Initial stylometry
  const initialHypothesis = await runStylometryHypothesis(scenarios);

  // Step 2: PROSE refinement loops (2 iterations per scenario)
  const refinedTraitsPerScenario: Record<string, string[]> = {};
  let personaDescriptor = initialHypothesis.summary || "";

  // Allow tuning iterations to reduce API pressure during load
  const loops = Math.max(1, Number(process.env.PROSE_ITERATIONS ?? 2));
  for (const s of scenarios) {
    const traitsAccum: string[] = [];
    let workingPersona = personaDescriptor;
    for (let i = 0; i < loops; i++) {
      const candidate = await generateCandidateReply(workingPersona, s);
      const deltas = await compareAndExtractDeltas(s.response, candidate);
      const refined = await refinePersonaDescriptor(workingPersona, deltas);
      workingPersona = refined.updatedPersona;
      traitsAccum.push(...refined.keyTraits);
    }
    refinedTraitsPerScenario[s.id] = dedupe(traitsAccum);
    personaDescriptor = workingPersona; // fold-in refinements across scenarios
  }

  // Step 3: Consistency verification across scenarios
  const validatedTraits = await verifyConsistencyAcrossScenarios(
    refinedTraitsPerScenario,
    scenarios
  );

  // Step 4: Final synthesis mapped into STYLE_PROFILE_SCHEMA
  // Attempt to extract any explicit greeting preference from questionnaire to bias final synthesis
  const explicitGreetingPref = extractGreetingPreference(questionnaire);

  return await synthesizeFinalProfile(
    personaDescriptor,
    validatedTraits,
    explicitGreetingPref
  );
}

function extractScenarioResponses(questionnaire: unknown) {
  const q = questionnaire as Record<string, unknown> | undefined;
  // Support both old and new payloads
  // New format: { profession, foundational, scenarios: [{ id, prompt, response }] }
  const scenariosAny = (q as Record<string, unknown> | undefined)
    ?.scenarios as unknown;
  if (Array.isArray(scenariosAny)) {
    return scenariosAny
      .map(
        (s: {
          id?: string;
          scenarioId?: string;
          prompt?: string;
          response?: string;
          responseText?: string;
        }) => ({
          id: s.id || s.scenarioId || "scenario",
          prompt: s.prompt,
          response: s.response || s.responseText,
        })
      )
      .filter((s: { response?: string }) => !!s.response);
  }
  // Old format: { scenarioResponses: [{ scenarioId, responseText }] }
  const legacy = (q as Record<string, unknown> | undefined)
    ?.scenarioResponses as unknown;
  if (Array.isArray(legacy)) {
    return legacy
      .map((s: { scenarioId: string; responseText: string }) => ({
        id: s.scenarioId,
        response: s.responseText,
      }))
      .filter((s: { response?: string }) => !!s.response);
  }
  return [] as Array<{ id: string; prompt?: string; response: string }>;
}

async function runStylometryHypothesis(
  scenarios: Array<{ id: string; response: string }>
) {
  const joined = scenarios
    .map((s) => `Scenario ${s.id} Response:\n${s.response}`)
    .join("\n\n---\n\n");

  const prompt = `You are a computational stylistics analyst.
Analyze the user's writing samples below and extract quantifiable stylistic features and a short hypothesis summary of their persona.

Return JSON with fields:
- features: {
  avgSentenceLength: number,
  typeTokenRatio: number,
  punctuationPatterns: string[],
  functionWords: string[],
  sentenceComplexity: "Simple"|"Moderate"|"Complex",
  vocabularyRichness: "Low"|"Medium"|"High"
}
- summary: string  // 2-3 sentences capturing tone, directness, and structure

SAMPLES:
${joined}`.trim();

  const approxTokens = Math.round(prompt.length / 4);
  if (approxTokens > 6000) {
    console.warn(`[AI] Large stylometry prompt (~${approxTokens} tokens).`);
  }
  const result = await withRetry(
    () =>
      withAiRateLimit(() =>
        generativeModel.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 512,
            responseMimeType: "application/json",
          },
        })
      ),
    { retries: 4 }
  );
  const text =
    result.response.candidates?.[0]?.content?.parts?.[0]?.text ||
    '{"features":{},"summary":""}';
  try {
    return JSON.parse(text);
  } catch {
    return { features: {}, summary: String(text).slice(0, 500) };
  }
}

async function generateCandidateReply(
  personaDescriptor: string,
  scenario: { id: string; prompt?: string; response: string }
) {
  const scenarioContext =
    scenario.prompt || `Write a reply for scenario ${scenario.id}.`;

  const prompt = `Persona hypothesis:
${personaDescriptor}

Scenario:
${scenarioContext}

Write a reply in one continuous block, no commentary.`;

  const approxTokens = Math.round(prompt.length / 4);
  if (approxTokens > 6000) {
    console.warn(
      `[AI] Large candidate reply prompt (~${approxTokens} tokens).`
    );
  }
  const result = await withRetry(
    () =>
      withAiRateLimit(() =>
        generativeModel.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
        })
      ),
    { retries: 4 }
  );
  return result.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function compareAndExtractDeltas(userText: string, modelText: string) {
  const prompt = `Act as a linguistic analyst.
Compare USER vs MODEL replies and list concrete deltas in tone, formality, word choice, structure, and intent.
Return a JSON object with fields: keyTraits (string[]), notes (string[]).

USER:
${userText}

MODEL:
${modelText}`;

  const approxTokens = Math.round(prompt.length / 4);
  if (approxTokens > 6000) {
    console.warn(`[AI] Large compare prompt (~${approxTokens} tokens).`);
  }
  const result = await withRetry(
    () =>
      withAiRateLimit(() =>
        generativeModel.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 400,
            responseMimeType: "application/json",
          },
        })
      ),
    { retries: 4 }
  );
  const text =
    result.response.candidates?.[0]?.content?.parts?.[0]?.text ||
    '{"keyTraits":[],"notes":[]}';
  try {
    return JSON.parse(text);
  } catch {
    return { keyTraits: [], notes: [String(text)] } as {
      keyTraits: string[];
      notes: string[];
    };
  }
}

async function refinePersonaDescriptor(
  currentPersona: string,
  deltas: { keyTraits: string[]; notes: string[] }
) {
  const prompt = `Current persona hypothesis:
${currentPersona}

Observed deltas to incorporate:
${JSON.stringify(deltas.keyTraits, null, 2)}

Update and tighten the persona description (3-5 bullet points). Return JSON with fields:
- updatedPersona: string // concise paragraph description
- keyTraits: string[] // distilled traits included`;

  const approxTokens = Math.round(prompt.length / 4);
  if (approxTokens > 6000) {
    console.warn(`[AI] Large refine prompt (~${approxTokens} tokens).`);
  }
  const result = await withRetry(
    () =>
      withAiRateLimit(() =>
        generativeModel.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 400,
            responseMimeType: "application/json",
          },
        })
      ),
    { retries: 4 }
  );
  const text =
    result.response.candidates?.[0]?.content?.parts?.[0]?.text ||
    '{"updatedPersona":"","keyTraits":[]}';
  try {
    return JSON.parse(text) as { updatedPersona: string; keyTraits: string[] };
  } catch {
    return { updatedPersona: currentPersona, keyTraits: deltas.keyTraits };
  }
}

async function verifyConsistencyAcrossScenarios(
  traitsPerScenario: Record<string, string[]>,
  scenarios: Array<{ id: string; response: string }>
) {
  // Flatten and count traits
  const counts = new Map<string, number>();
  Object.values(traitsPerScenario).forEach((arr) => {
    for (const t of arr) counts.set(t, (counts.get(t) || 0) + 1);
  });
  const consistent = [...counts.entries()]
    .filter(([_, c]) => c >= Math.min(2, scenarios.length))
    .map(([t]) => t);

  // Let model double-check and tag context-dependent traits
  const prompt = `Given these candidate traits extracted from multiple samples:
${JSON.stringify(consistent, null, 2)}

Validate which are universal vs context-dependent across the user's three scenario responses. Return JSON:
{ "universal": string[], "contextual": string[] }`;

  const approxTokens = Math.round(prompt.length / 4);
  if (approxTokens > 6000) {
    console.warn(`[AI] Large consistency prompt (~${approxTokens} tokens).`);
  }
  const result = await withRetry(
    () =>
      withAiRateLimit(() =>
        generativeModel.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 300,
            responseMimeType: "application/json",
          },
        })
      ),
    { retries: 4 }
  );
  const text =
    result.response.candidates?.[0]?.content?.parts?.[0]?.text ||
    '{"universal":[],"contextual":[]}';
  try {
    return JSON.parse(text) as { universal: string[]; contextual: string[] };
  } catch {
    return { universal: consistent, contextual: [] };
  }
}

async function synthesizeFinalProfile(
  personaDescriptor: string,
  validated: { universal: string[]; contextual: string[] },
  greetingPref?: string
) {
  const prompt = `Synthesize a complete email writing style profile matching the JSON schema fields below. 
Use this persona descriptor and universal traits as authoritative, and consider contextual traits as optional variations.

Persona descriptor:
${personaDescriptor}

Universal traits:
${JSON.stringify(validated.universal, null, 2)}

Contextual traits (lower weight):
${JSON.stringify(validated.contextual, null, 2)}

${greetingPref ? `User's explicit preferred greeting style (seed this into structuralPreferences.greetingStyle lists appropriately): ${greetingPref}` : ""}

Return strictly valid JSON conforming to the provided schema.`;

  const generationConfig = {
    temperature: 0.25,
    topP: 0.8,
    topK: 40,
    maxOutputTokens: 1400,
    responseMimeType: "application/json",
    responseSchema: STYLE_PROFILE_SCHEMA,
  };

  const approxTokens = Math.round(prompt.length / 4);
  if (approxTokens > 6000) {
    console.warn(
      `[AI] Large final synthesis prompt (~${approxTokens} tokens).`
    );
  }
  const result = await withRetry(
    () =>
      withAiRateLimit(() =>
        generativeModel.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig,
        })
      ),
    { retries: 5, baseDelayMs: 900 }
  );
  const text =
    result.response.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  try {
    return JSON.parse(text);
  } catch {
    console.warn(
      "[AI] Final synthesis JSON parse failed, returning empty profile"
    );
    return {} as AIStyleProfile;
  }
}

function dedupe(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean).map((s) => s.trim())));
}

function extractGreetingPreference(questionnaire: unknown): string | undefined {
  try {
    const q = questionnaire as Record<string, unknown>;
    // Support shapes like { foundational: { greetingPreference: 'Hi {FirstName}' } }
    const foundational =
      (q?.["foundational"] as Record<string, unknown> | undefined) ?? undefined;
    const fgp = foundational?.["greetingPreference"] as unknown;
    const topLevel = q?.["greetingPreference"] as unknown;
    const gp = (
      typeof fgp === "string"
        ? fgp
        : typeof topLevel === "string"
          ? topLevel
          : undefined
    ) as string | undefined;
    if (gp && gp.length > 0) return gp;
  } catch {
    // ignore
  }
  return undefined;
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
  styleProfile: AIStyleProfile,
  emailContext: {
    originalEmail: string;
    threadHistory?: string[];
    tone?: string;
    // New optional contextual enrichments
    senderName?: string;
    senderEmail?: string;
    senderCompany?: string;
    recipientName?: string; // the user's own name can be passed to personalize greeting
  },
  userPreferences?: {
    signature?: string;
  }
): Promise<string> {
  try {
    // Trim overly long inputs to avoid excessive tokens
    const clamp = (s: string, max = 4000) =>
      s.length > max ? s.slice(0, max) + "…" : s;
    const safeOriginal = clamp(emailContext.originalEmail, 4000);
    const history = emailContext.threadHistory ?? [];
    const safeHistory = history
      .slice(Math.max(0, history.length - 3)) // last 3 items
      .map((h) => clamp(h, 1500));

    const prompt = `
You are an AI email assistant that writes emails in the exact style of a specific user.

**USER'S WRITING STYLE PROFILE:**
${JSON.stringify(styleProfile, null, 2)}

**EMAIL CONTEXT:**
Original Email: ${safeOriginal}
${safeHistory.length ? `Thread History: ${safeHistory.join("\n---\n")}` : ""}
${emailContext.senderName ? `Sender Name: ${emailContext.senderName}` : ""}
${emailContext.senderEmail ? `Sender Email: ${emailContext.senderEmail}` : ""}
${emailContext.senderCompany ? `Sender Company/Firm: ${emailContext.senderCompany}` : ""}
${emailContext.recipientName ? `User's Name (reply author): ${emailContext.recipientName}` : ""}

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
 - Personalize the greeting and body using the sender name and company when available (e.g., "Hi Sarah" or referencing "Acme" where natural). Avoid fabricating details.
- If senderName is available, begin with an appropriate greeting using their name (e.g., "Hi Sarah,").
- If recipientName (user's name) or a signature is available, include a natural sign-off that uses it. Do not fabricate a name if none is provided.
- Do not use placeholders like [Name] or [Company]; omit if unknown.

Generate the email draft now:
    `.trim();

    const generationConfig = {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 1024,
    };

    // Use Vertex AI
    console.warn("[AI] Generating email draft with Vertex AI...");

    const approxTokens = Math.round(prompt.length / 4);
    if (approxTokens > 6000) {
      console.warn(
        `[AI] Large email draft prompt (~${approxTokens} tokens). Consider trimming history.`
      );
    }
    const result = await withRetry(
      () =>
        withAiRateLimit(() =>
          generativeModel.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig,
          })
        ),
      { retries: 4, baseDelayMs: 700 }
    );

    const response = result.response;
    const candidate = response.candidates?.[0];
    const content = candidate?.content;
    const part = content?.parts?.[0];
    const draft = part?.text || "";

    console.warn("[AI] Email draft generated successfully (Vertex AI)");
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
    console.warn("[AI] Testing Vertex AI connection...");

    const projectId = process.env.VERTEX_AI_PROJECT_ID || "draftly-4572a";
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

    console.warn("[AI] ✓ Vertex AI connection successful");
    console.warn(`[AI] Project: ${projectId}`);
    console.warn(`[AI] Location: ${location}`);
    console.warn(`[AI] Model: gemini-2.0-flash-001`);

    return { connected: true, provider: "Vertex AI" };
  } catch (error: unknown) {
    const message = (error as Error)?.message || String(error);
    console.error("[AI] Vertex AI connection test failed:", message);

    // Provide helpful error messages
    let errorMessage = "Unknown error";

    if (message?.includes?.("403")) {
      errorMessage =
        "Permission denied. Check service account has 'Vertex AI User' role or enable billing";
    } else if (message?.includes?.("404")) {
      errorMessage = "API not found. Check project ID and location";
    } else if (message?.includes?.("PERMISSION_DENIED")) {
      errorMessage =
        "API not enabled or lacks permissions. Visit: https://console.developers.google.com/apis/api/aiplatform.googleapis.com";
    } else if ((error as unknown as { code?: string })?.code === "ENOENT") {
      errorMessage = "Credentials file not found";
    } else {
      errorMessage = message;
    }

    return {
      connected: false,
      provider: "Vertex AI",
      error: errorMessage,
    };
  }
}
