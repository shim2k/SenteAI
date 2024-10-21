import OpenAI from "openai";
import { reminderContext } from "../utils/contexts";

class OpenAIServiceClass {
    options: {
        token: string;
    };
    openai: OpenAI;
    personName: string;
    senteContext: string;

    constructor() {
        this.personName = 'Shimi';
        this.senteContext = reminderContext;

        this.openai = new OpenAI();
        this.options = {
            token: process.env.OPENAI_API_KEY!,
        };
    }

    async sendMessage(messages: Array<{ role: string; content: string }>): Promise<string> {
        const completion = await this.openai.chat.completions.create({
            model: "gpt-4o-mini",
            // @ts-ignore
            messages,
        });
        // @ts-ignore
        return completion.choices[0].message.content
    }
}

export default OpenAIServiceClass;