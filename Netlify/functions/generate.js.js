const DAILY_LIMIT = 10;
const usageMap = {};

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const ip = event.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  const today = getToday();
  const key = `${ip}_${today}`;

  if (!usageMap[key]) usageMap[key] = 0;

  if (usageMap[key] >= DAILY_LIMIT) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: `Daily limit reached (${DAILY_LIMIT} generations/day). Come back tomorrow ✨` }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const { characterImage, characterMediaType, roomImage, roomMediaType, tier, pose, tierDetails, poseDetails } = body;

  if (!characterImage || !roomImage || !tier || !pose) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields" }) };
  }

  const systemPrompt = `You are a luxury creative director generating hyper-detailed image prompts for AI image generation tools. You analyse reference images deeply and produce cinematic, specific, brand-level prompts. Output ONLY the prompt — no preamble, no explanation, no markdown.`;

  const userPrompt = `TGPS_V5 | ${tier} | ${pose}

You have two reference images: IMAGE 1 is the CHARACTER reference. IMAGE 2 is the ROOM reference.

ABSOLUTE RULES:
1. CHARACTER IDENTITY IS LOCKED. Open with exactly: "Ultra-photorealistic [scene type] of the same woman from the uploaded reference, maintaining identical facial features, hair, skin tone, and identity."
2. ROOM IS NEVER FURNITURE-LISTED. Analyse room for: mood, dominant colors and palette, light source quality and direction, architectural style, overall luxury level.
3. OUTFIT MUST BE HIGH-END AND SPECIFIC. Use real luxury brands.
4. POSE MUST BE FULLY WRITTEN as cinematic direction.
5. OUTPUT ONLY THE PROMPT.

STYLE TIER: ${tier}
POSE: ${pose}
Pose direction: ${poseDetails}
Skin: ${tierDetails.sk}
Hair: ${tierDetails.hr}
Makeup: ${tierDetails.mk}
Outfit: ${tierDetails.ot}
Lighting: ${tierDetails.lt}
Camera: ${tierDetails.pc}
Mood: ${tierDetails.md}
Environmental integration: ${tierDetails.ei}

OUTPUT in this exact structure:

Ultra-photorealistic [scene type] of the same woman from the uploaded reference, maintaining identical facial features, hair, skin tone, and identity.

Pose:
[fully written cinematic pose direction]

Environmental Interaction:
[one precise sentence]

Skin:
[skin finish]

Hair:
[specific named style]

Makeup:
[complete product-level breakdown]

Outfit:
[every garment named with exact fabric, color, cut, and fit — shoes, bag, every jewelry piece with brand]

Lighting:
[room light translated into photographic language]

Camera:
[${tierDetails.pc}]

Mood:
[${tierDetails.md}]

Negative prompts:
no identity drift, no facial redescription, no new face features, no stiff posture, no mannequin posing, no awkward limbs, no unrealistic lighting, no cartoon tones, no oversmoothed skin, no distorted anatomy, no warped hands, no duplicate limbs`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: characterMediaType, data: characterImage } },
            { type: "image", source: { type: "base64", media_type: roomMediaType, data: roomImage } },
            { type: "text", text: userPrompt }
          ]
        }]
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Anthropic API error");
    }

    const text = data.content?.map(i => i.text || "").join("").trim();
    if (!text) throw new Error("Empty response from API");

    usageMap[key]++;
    const remaining = DAILY_LIMIT - usageMap[key];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ prompt: text, remaining }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Generation failed" }),
    };
  }
};
