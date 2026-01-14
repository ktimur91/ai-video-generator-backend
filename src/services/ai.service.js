const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Генерирует сценарий для YouTube Shorts через OpenAI
 * @param {string} topic - Тема для генерации сценария
 * @returns {Promise<{title: string, script: string}>}
 */
async function generateScript(topic) {
  const systemPrompt = `Ты - креативный сценарист для YouTube Shorts. 
Твоя задача - создавать короткие, захватывающие сценарии длительностью 30-60 секунд.
Сценарий должен быть динамичным, с хуком в начале и призывом к действию в конце.
Отвечай ТОЛЬКО в формате JSON: { "title": "заголовок видео", "script": "текст сценария" }`;

  const userPrompt = `Создай сценарий для YouTube Shorts на тему: "${topic}"`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    const result = JSON.parse(content);

    if (!result.title || !result.script) {
      throw new Error("Invalid response format from OpenAI");
    }

    return {
      title: result.title,
      script: result.script,
    };
  } catch (error) {
    console.error("Error generating script:", error);
    throw new Error(`Failed to generate script: ${error.message}`);
  }
}

module.exports = {
  generateScript,
};
