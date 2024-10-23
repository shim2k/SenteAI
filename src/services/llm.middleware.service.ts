import OpenAIServiceClass from './openai.service';
import logger from '../utils/logger';
import { DateTime } from 'luxon';

type MiddlewareOperation = 'location_to_timezone' | 'sentiment_analysis' | 'language_detection' | 'text_summarization';

interface MiddlewareConfig<InputType, OutputType> {
    systemPrompt: string;
    userPromptTemplate: (input: InputType) => string;
    parseResponse: (response: string) => OutputType;
}

class LLMMiddlewareService {
    private openaiService: OpenAIServiceClass;
    private middlewareConfigs: Map<MiddlewareOperation, MiddlewareConfig<any, any>>;

    constructor(openaiService: OpenAIServiceClass) {
        this.openaiService = openaiService;
        this.middlewareConfigs = new Map();
        this.initializeMiddlewares();
    }

    private initializeMiddlewares() {
        this.middlewareConfigs.set('location_to_timezone', {
            systemPrompt: 'You are a helpful assistant that converts locations to timezones.',
            userPromptTemplate: (input: string) =>
                `Given the following location: "${input}"
Please provide the most likely IANA timezone for this location. Use the format "Continent/City" (e.g., "America/New_York", "Europe/London", "Asia/Tokyo").
If unsure or ambiguous, provide your best guess and explain your reasoning.
Response format: <timezone>|<explanation>`,
            parseResponse: (response: string) => {
                const [timezone, explanation] = response.split('|');
                return { timezone: timezone.trim(), explanation: explanation.trim() };
            },
        });
    }

    async processUserInput<InputType, OutputType>(
        input: InputType,
        operation: MiddlewareOperation
    ): Promise<OutputType> {
        const config = this.middlewareConfigs.get(operation);
        if (!config) {
            throw new Error(`Unsupported operation: ${operation}`);
        }

        const userPrompt = config.userPromptTemplate(input);

        const response = await this.openaiService.sendMessage([
            { role: 'system', content: config.systemPrompt },
            { role: 'user', content: userPrompt },
        ]);

        const result = config.parseResponse(response);
        logger.info(`Processed ${operation} for input "${input}". Result:`, result);
        return result;
    }

    // Method to add new middleware configurations dynamically
    addMiddleware<InputType, OutputType>(
        operation: MiddlewareOperation,
        config: MiddlewareConfig<InputType, OutputType>
    ) {
        this.middlewareConfigs.set(operation, config);
    }

    // Additional method to validate timezone using Luxon
    validateTimezone(timezone: string): boolean {
        return DateTime.local().setZone(timezone).isValid;
    }
}

export default LLMMiddlewareService;