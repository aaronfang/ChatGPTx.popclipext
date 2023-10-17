import axios from "axios";

// Ref: https://pilotmoon.github.io/PopClip-Extensions/interfaces/PopClip.html
// Source: https://github.com/pilotmoon/PopClip-Extensions/blob/master/popclip.d.ts

interface PasteboardContent {
    'public.utf8-plain-text'?: string
    'public.html'?: string
    'public.rtf'?: string
}

interface Input {
    content: PasteboardContent
    // data: { emails: RangedStrings; nonHttpUrls: RangedStrings; paths: RangedStrings; urls: RangedStrings }
    html: string
    markdown: string
    matchedText: string
    rtf: string
    text: string
    xhtml: string
}

interface Context {
    hasFormatting: boolean
    canPaste: boolean
    canCopy: boolean
    canCut: boolean
    browserUrl: string
    browserTitle: string
    appName: string
    appIdentifier: string
}

interface Modifiers {
    /** Shift (⇧) key state. */
    shift: boolean
    /** Control (⌃) key state. */
    control: boolean
    /** Option (⌥) key state. */
    option: boolean
    /** Command (⌘) key state. */
    command: boolean
}

interface Options {
    apiType: "openai" | "azure"
    apiBase: string
    apiKey: string
    apiVersion: string
    model: string
    temperature: string

    reviseEnabled: boolean
    revisePrimaryLanguage: string
    reviseSecondaryLanguage: string
    reviseInstruction: string

    polishEnabled: boolean
    polishPrimaryLanguage: string
    polishSecondaryLanguage: string
    polishInstruction: string

    translateEnabled: boolean
    translatePrimaryLanguage: string
    translateSecondaryLanguage: string
    translateInstruction: string

    summarizeEnabled: boolean
    summarizePrimaryLanguage: string
    summarizeSecondaryLanguage: string
    summarizeInstruction: string

    slangEnabled: boolean
    slangPrimaryLanguage: string
    slangSecondaryLanguage: string
    slangInstruction: string

    expandEnabled: boolean
    expandPrimaryLanguage: string
    expandSecondaryLanguage: string
    expandInstruction: string

    midjourneyEnabled: boolean
    midjourneyPrimaryLanguage: string
    midjourneySecondaryLanguage: string
    midjourneyInstruction: string

    stablediffusionEnabled: boolean
    stablediffusionPrimaryLanguage: string
    stablediffusionSecondaryLanguage: string
    stablediffusionInstruction: string

    customEnabled: boolean
    customPrimaryLanguage: string
    customSecondaryLanguage: string
    customInstruction: string
    // prompts: string
}

interface PopClip {
    context: Context
    modifiers: Modifiers
    showSuccess(): void
    showFailure(): void
    showText(text: string, options?: { preview?: boolean }): void
    copyText(text: string): void
    pasteText(text: string, options?: { restore?: boolean }): void
}

// Ref: https://platform.openai.com/docs/api-reference/chat/create

interface Message {
    role: "user" | "system" | "assistant"
    content: string
}

interface APIRequestData {
    model: string
    messages: Array<Message>
    temperature?: number
    top_p?: number
}

interface APIResponse {
    data: {
        choices: [{
            message: Message
        }];
    }
}

type AllowedOneTimeActions = "translate" | "slang" | "revise" | "polish" | "expand" | "summarize"  | "midjourney" | "stablediffusion" | "custom"
type AllowedActions = "chat" | AllowedOneTimeActions

abstract class ChatGPTAction {
    abstract beforeRequest(popclip: PopClip, input: Input, options: Options, action: AllowedActions): { allow: boolean, reason?: string }
    abstract makeRequestData(popclip: PopClip, input: Input, options: Options, action: AllowedActions): APIRequestData | null
    processResponse(popclip: PopClip, resp: APIResponse): string {
        return resp.data.choices[0].message.content.trim()
    }
    onRequestError(popclip: PopClip, e: unknown) { }
    doCleanup(): void { }
}

const InactiveChatHistoryResetIntervalMs = 20 * 1000 * 60 // 20 minutes.
// const MaxChatHistoryLength = 50

class ChatHistory {
    readonly appIdentifier: string
    private _lastActiveAt: Date
    private _messages: Array<Message>

    constructor(appIdentifier: string) {
        this.appIdentifier = appIdentifier
        this._lastActiveAt = new Date()
        this._messages = []
    }

    isActive(): boolean {
        return new Date().getTime() - this._lastActiveAt.getTime() < InactiveChatHistoryResetIntervalMs
    }

    clear() {
        this._messages.length = 0
    }

    push(message: Message) {
        this._messages.push(message)
        this._lastActiveAt = new Date()
    }

    pop(): Message | undefined {
        return this._messages.pop()
    }

    get lastActiveAt(): Date {
        return this._lastActiveAt
    }

    get messages(): Array<Message> {
        return this._messages
    }
}

class ChatAction extends ChatGPTAction {
    // Chat histories grouped by application identify.
    private chatHistories: Map<string, ChatHistory>

    constructor() {
        super()
        this.chatHistories = new Map()
    }

    private getChatHistory(appIdentifier: string): ChatHistory {
        let chat = this.chatHistories.get(appIdentifier)
        if (!chat) {
            chat = new ChatHistory(appIdentifier)
            this.chatHistories.set(appIdentifier, chat)
        }
        return chat
    }

    doCleanup() {
        for (const [appid, chat] of this.chatHistories) {
            if (!chat.isActive()) {
                this.chatHistories.delete(appid)
            }
        }
    }

    beforeRequest(popclip: PopClip, input: Input, options: Options, action: AllowedActions): { allow: boolean, reason?: string } {
        if (popclip.modifiers.shift) {
            this.chatHistories.delete(popclip.context.appIdentifier)
            const text = `${popclip.context.appName}(${popclip.context.appIdentifier})'s chat history has been cleared`
            return { allow: false, reason: text }
        }
        return { allow: true }
    }

    makeRequestData(popclip: PopClip, input: Input, options: Options, action: AllowedActions): APIRequestData | null {
        if (action !== "chat") {
            return null
        }
        const chat = this.getChatHistory(popclip.context.appIdentifier)
        chat.push({ role: "user", content: input.text })
        return {
            model: options.model,
            messages: chat.messages,
            temperature: Number(options.temperature),
        }
    }

    onRequestError(popclip: PopClip, e: unknown) {
        const chat = this.getChatHistory(popclip.context.appIdentifier)
        chat.pop() // Pop out the user message.
    }

    processResponse(popclip: PopClip, resp: APIResponse): string {
        const chat = this.getChatHistory(popclip.context.appIdentifier)
        chat.push(resp.data.choices[0].message)
        return resp.data.choices[0].message.content.trim()
    }
}

// Define default instructions
const DEFAULT_REVISE_INSTRUCTION = 'Please revise the text to improve its clarity, brevity, and coherence. Document the changes made and provide a concise explanation for each modification (IMPORTANT: reply with target_language language).';
const DEFAULT_POLISH_INSTRUCTION = 'Please correct the grammar and polish the text while adhering as closely as possible to the original intention (IMPORTANT: reply with target_language language).';
const DEFAULT_TRANSLATE_INSTRUCTION = 'Please translate the text into target_language and only provide me with the translated content without formating.';
const DEFAULT_SUMMARIZE_INSTRUCTION = 'Please provide a concise summary of the text, ensuring that all significant points are included (IMPORTANT: reply with target_language language).';
const DEFAULT_SLANG_INSTRUCTION = `You are an adept artificial intelligence translator, especially skilled at converting text from various languages into natural, conversational target_language. Your goal is to ensure that the translated outcome not only accurately conveys the meaning of the original text but also sounds as if it were spoken by a native target_language speaker in a friendly and relaxed manner. Please refrain from rigid or overly formal tones, striving instead to give the translation the feel of everyday conversation.`
const DEFAULT_EXPAND_INSTRUCTION = `As a writer with a talent for language, your task is to refine and polish the text I input, expanding it into more detailed paragraphs in target_language.`
const DEFAULT_MIDJOURNEY_INSTRUCTION = `从现在开始，你是一名翻译，你会根据我输入的内容，翻译成target_language。请注意，你翻译后的内容主要服务于一个绘画AI，它只能理解具象的描述而非抽象的概念，同时根据你对绘画AI的理解，比如它可能的训练模型、自然语言处理方式等方面，进行翻译优化。由于我的描述可能会很散乱，不连贯，你需要综合考虑这些问题，然后对翻译后的内容再次优化或重组，从而使绘画AI更能清楚我在说什么。请严格按照此条规则进行翻译。 例如，我输入：一只想家的小狗。
你不能输出：
A homesick little dog.
你必须输出：
A small dog that misses home, with a sad look on its face and its tail tucked between its legs. It might be standing in front of a closed door or a gate, gazing longingly into the distance, as if hoping to catch a glimpse of its beloved home.
当我输入内容后，请翻译我需要的target_language内容`
const DEFAULT_STABLEDIFFUSION_INSTRUCTION = `You are a prompt AI for Stable Difussion AI, Stable Difussion is an image creation AI which is mainly used by receiving prompts and turning them into images, the only issue with stable difussion is its lack of consistency and difficulty to prompt demmanding users to use long and very technical prompts, this is where you come in handy, you will create the prompts for the user based on their request and make them be used in Stable Difussion. Here are some good examples：
{
    "prompt": "8k portrait of beautiful cyborg with brown hair, intricate, elegant, highly detailed, majestic, digital photography, art by artgerm and ruan jia and greg rutkowski surreal painting gold butterfly filigree, broken glass, (masterpiece, sidelighting, finely detailed beautiful eyes: 1.2), hdr, (detailed background window to a new dimension, plants and flowers:0.7) lora:more_details:0.5 infinity, infinite symbol",
    "Negative prompt": "BadDream, FastNegativeV2"
},
{
    "prompt": "1girl, japanese clothes, ponytail ,white hair, purple eyes, magic circle, blue fire, blue flames, wallpaper, landscape, blood, blood splatter, depth of field, night, light particles, light rays, sidelighting, thighs, fate \(series\), genshin impact, ****, open jacket, skirt, thighhighs, cloud",
    "Negative prompt": "(worst quality:1.6, low quality:1.6), (zombie, sketch, interlocked fingers, comic)"
},
{
    "prompt": "a portrait photo of a beautiful woman with curls and lots of freckles, (dirty blonde hair), (face portrait:1.5), dramatic light , Rembrandt lighting scheme, (hyperrealism:1.2), (photorealistic:1.2), shot with Canon EOS 5D Mark IV, detailed face, detailed hair",
    "Negative prompt": "(deformed iris, deformed pupils, semi-realistic, cgi, 3d, render, sketch, cartoon, drawing, anime, mutated hands and fingers:1.4), (deformed, distorted, disfigured:1.3), poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, disconnected limbs, mutation, mutated, ugly, disgusting, amputation"
},
{
    "prompt": "digital art, fantasy style, medium shot of a sexy mature woman posing in front of night jungle, elf witch, dark skin, ponytail, black hair, huge breasts, Sophia Loren, blood, leather wristband, short ripped cloak with hood, pelvic curtain, red sash, black latex bodysuit, flat colors, low camera angle, dynamic pose, looking confident, looking serious, looking off into distance, masterpiece, best quality, high quality, absurdres, realistic, UHD,",
    "Negative prompt": "EasyNegative, drawn by bad-artist, sketch by bad-artist-anime, (bad_prompt:0.8), (artist name, signature, watermark:1.4), (ugly:1.2), (worst quality, poor details:1.4), bad-hands-5, badhandv4, blurry, child, loli, kids"
}
I will give you a description. Please create positive and negative prompts in English based on this description, and return to me in the format of JSON.`
const DEFAULT_CUSTOM_INSTRUCTION = `Please reply with target_language language.`

class OneTimeAction extends ChatGPTAction {
    private getPrompt(action: AllowedOneTimeActions, language: string, options: Options): string {
        switch (action) {
            case "translate":
                const translateInstruction = options.translateInstruction || DEFAULT_TRANSLATE_INSTRUCTION.replace('target_language', language);
                return translateInstruction;
            case "slang":
                const slangInstruction = options.slangInstruction || DEFAULT_SLANG_INSTRUCTION.replace('target_language', language);
                return slangInstruction;
            case "revise":
                const reviseInstruction = options.reviseInstruction || DEFAULT_REVISE_INSTRUCTION.replace('target_language', language);
                return reviseInstruction;
            case "polish":
                const polishInstruction = options.polishInstruction || DEFAULT_POLISH_INSTRUCTION.replace('target_language', language);
                return polishInstruction;
            case "expand":
                const expandInstruction = options.expandInstruction || DEFAULT_EXPAND_INSTRUCTION.replace('target_language', language);
                return expandInstruction;
            case "summarize":
                const summarizeInstruction = options.summarizeInstruction || DEFAULT_SUMMARIZE_INSTRUCTION.replace('target_language', language);
                return summarizeInstruction;
            case "midjourney":
                const midjourneyInstruction = options.midjourneyInstruction || DEFAULT_MIDJOURNEY_INSTRUCTION.replace('target_language', language);
                return midjourneyInstruction;
            case "stablediffusion":
                const stablediffusionInstruction = options.stablediffusionInstruction || DEFAULT_STABLEDIFFUSION_INSTRUCTION.replace('target_language', language);
                return stablediffusionInstruction;
            case "custom":
                const customInstruction = options.customInstruction || DEFAULT_CUSTOM_INSTRUCTION.replace('target_language', language);
                return customInstruction;
            }
    }

    beforeRequest(popclip: PopClip, input: Input, options: Options, action: AllowedActions): { allow: boolean, reason?: string } {
        return { allow: options[`${action}Enabled`] }
    }

    makeRequestData(popclip: PopClip, input: Input, options: Options, action: AllowedActions): APIRequestData | null {
        if (action === "chat") {
            return null
        }

        const language = popclip.modifiers.shift ? options[`${action}SecondaryLanguage`] : options[`${action}PrimaryLanguage`]
        const prompt = this.getPrompt(action as AllowedOneTimeActions, language, options)
        return {
            model: options.model,
            messages: [
                // { role: "system", content: "You are a professional multilingual assistant who will help me revise, polish, or translate texts. Please strictly follow user instructions." },
                {
                    role: "user", content: `${prompt}
The input text being used for this task is enclosed within triple quotation marks below the next line:

"""${input.text}"""`,
                },
            ],
            temperature: Number(options.temperature),
        }
    }
}

function makeClientOptions(options: Options): object {
    const timeoutMs = 35000
    if (options.apiType === "openai") {
        return {
            "baseURL": options.apiBase,
            headers: { Authorization: `Bearer ${options.apiKey}` },
            timeout: timeoutMs,
        }
    } else if (options.apiType === "azure") {
        // Ref: https://learn.microsoft.com/en-us/azure/ai-services/openai/reference#chat-completions
        return {
            "baseURL": options.apiBase,
            headers: { "api-key": `${options.apiKey}` },
            params: {
                "api-version": options.apiVersion,
            },
            timeout: timeoutMs,
        }
    }
    throw new Error(`unsupported api type: ${options.apiType}`);
}

function isTerminalApplication(appName: string): boolean {
    return appName === "iTerm2" || appName === "Terminal"
}

const chatGPTActions: Map<AllowedActions, ChatAction | OneTimeAction> = new Map();

function doCleanup() {
    for (const [_, actionImpl] of chatGPTActions) {
        actionImpl.doCleanup()
    }
}

async function doAction(popclip: PopClip, input: Input, options: Options, action: AllowedActions) {
    doCleanup()

    const actionImpl = chatGPTActions.get(action)!
    const guard = actionImpl.beforeRequest(popclip, input, options, action)
    if (!guard.allow) {
        if (guard.reason) {
            popclip.showText(guard.reason)
            popclip.showSuccess()
        }
        return
    }

    const requestData = actionImpl.makeRequestData(popclip, input, options, action)!

    const openai = axios.create(makeClientOptions(options))
    try {
        const resp: APIResponse = await openai.post(
            "chat/completions", requestData
        )
        const result = actionImpl.processResponse(popclip, resp).replace(/^"|"$/g, '')

        if (popclip.context.canPaste) {
        //     let toBePasted = `\n\n${result}\n`
        //     if (!isTerminalApplication(popclip.context.appName) && popclip.context.canCopy) {
        //         // Prevent the original selected text from being replaced.
        //         toBePasted = `${input.text}\n\n${result}\n`
        //     }
        //     popclip.pasteText(toBePasted, { restore: true })
        //     popclip.showSuccess()
        // } else {
            let toBePasted = `${result}`
            popclip.pasteText(toBePasted, { restore: true })
            popclip.showSuccess()
        } else {
            popclip.copyText(result)
            popclip.showText(result, { preview: true })
        }
    } catch (e) {
        actionImpl.onRequestError(popclip, e)

        // popclip.showFailure()
        popclip.showText(String(e))
    }
}

chatGPTActions.set("chat", new ChatAction())
chatGPTActions.set("revise", new OneTimeAction())
chatGPTActions.set("polish", new OneTimeAction())
chatGPTActions.set("translate", new OneTimeAction())
chatGPTActions.set("summarize", new OneTimeAction())
chatGPTActions.set("slang", new OneTimeAction())
chatGPTActions.set("expand", new OneTimeAction())
chatGPTActions.set("midjourney", new OneTimeAction())
chatGPTActions.set("stablediffusion", new OneTimeAction())
chatGPTActions.set("custom", new OneTimeAction())

export const actions = [
    {
        title: "ChatGPTx: do what you want (click while holding shift(⇧) to force clear the history for this app)",
        // icon: "symbol:arrow.up.message.fill", // icon: "iconify:uil:edit",
        requirements: ["text"],
        code: async (input: Input, options: Options, context: Context) => doAction(popclip, input, options, "chat"),
    },
    {
        title: "ChatGPTx: revise text (click while holding shift(⇧) to use the secondary language)",
        icon: "symbol:r.square.fill", // icon: "iconify:uil:edit",
        requirements: ["text", "option-reviseEnabled=1"],
        code: async (input: Input, options: Options, context: Context) => doAction(popclip, input, options, "revise"),
    },
    {
        title: "ChatGPTx: polish text (click while holding shift(⇧) to use the secondary language)",
        icon: "circle filled 磨", // icon: "iconify:lucide:stars",
        requirements: ["text", "option-polishEnabled=1"],
        code: async (input: Input, options: Options, context: Context) => doAction(popclip, input, options, "polish"),
    },
    {
        title: "ChatGPTx: translate text (click while holding shift(⇧) to use the secondary language)",
        icon: "circle filled 译", // icon: "iconify:system-uicons:translate",
        requirements: ["text", "option-translateEnabled=1"],
        code: async (input: Input, options: Options, context: Context) => doAction(popclip, input, options, "translate"),
    },
    {
        title: "ChatGPTx: summarize text (click while holding shift(⇧) to use the secondary language)",
        icon: "circle filled 概", // icon: "iconify:system-uicons:translate",
        requirements: ["text", "option-summarizeEnabled=1"],
        code: async (input: Input, options: Options, context: Context) => doAction(popclip, input, options, "summarize"),
    },
    {
        title: "ChatGPTx: slang text (click while holding shift(⇧) to use the secondary language)",
        icon: "circle filled 俚", // icon: "iconify:system-uicons:translate",
        requirements: ["text", "option-slangEnabled=1"],
        code: async (input: Input, options: Options, context: Context) => doAction(popclip, input, options, "slang"),
    },
    {
        title: "ChatGPTx: expand text (click while holding shift(⇧) to use the secondary language)",
        icon: "circle filled 扩", // icon: "iconify:system-uicons:translate",
        requirements: ["text", "option-expandEnabled=1"],
        code: async (input: Input, options: Options, context: Context) => doAction(popclip, input, options, "expand"),
    },
    {
        title: "ChatGPTx: midjourney text (click while holding shift(⇧) to use the secondary language)",
        icon: "square filled MJ", // icon: "iconify:system-uicons:translate",
        requirements: ["text", "option-midjourneyEnabled=1"],
        code: async (input: Input, options: Options, context: Context) => doAction(popclip, input, options, "midjourney"),
    },
    {
        title: "ChatGPTx: stablediffusion text (click while holding shift(⇧) to use the secondary language)",
        icon: "square filled SD", // icon: "iconify:system-uicons:translate",
        requirements: ["text", "option-stablediffusionEnabled=1"],
        code: async (input: Input, options: Options, context: Context) => doAction(popclip, input, options, "stablediffusion"),
    },
    {
        title: "ChatGPTx: custom text (click while holding shift(⇧) to use the secondary language)",
        icon: "circle filled 自", // icon: "iconify:system-uicons:translate",
        requirements: ["text", "option-customEnabled=1"],
        code: async (input: Input, options: Options, context: Context) => doAction(popclip, input, options, "custom"),
    },
]

// Dynamic options:
//
// Prompt to list languages:
//   list top 100 languages that you can understand and generate texts in,
//   remove all dialects, such as Chinese dialects(but do include "Chinese Simplified" and "Chinese Traditional" ),
//   reply in JSON format using both English and their corresponding native language, e.g. [{"english": "Chinese Simplified", "native": "简体中文"}].
//
//   Please double check and count by yourself first.
//
// (Unfortunately, ChatGPT is unable to list 100 languages and I am exhausted from trying to make it accurate..)
import * as languages from "./top-languages-from-chatgpt.json"
const optionLanguagesValues: Array<string> = new Array()
const optionLanguagesValueLabels: Array<string> = new Array()

languages.sort((a, b) => {
    if (a.english < b.english) {
        return -1
    } else if (a.english > b.english) {
        return 1
    }
    return 0
}).forEach((value) => {
    optionLanguagesValues.push(value.english)
    optionLanguagesValueLabels.push(value.native)
})

const chatGPTActionsOptions: Array<any> = [
    {
        "identifier": "apiType",
        "label": "API Type",
        "type": "multiple",
        "default value": "azure",
        "values": [
            "openai",
            "azure"
        ]
    },
    {
        "identifier": "apiBase",
        "label": "API Base URL",
        "description": "For Azure: https://{resource-name}.openai.azure.com/openai/deployments/{deployment-id}",
        "type": "string",
        "default value": "https://api.openai.com/v1"
    },
    {
        "identifier": "apiKey",
        "label": "API Key",
        "type": "string",
    },
    {
        "identifier": "model",
        "label": "Model",
        "type": "string",
        "default value": "gpt-4-32k"
    },
    {
        "identifier": "apiVersion",
        "label": "API Version (Azure only)",
        "type": "string",
        "default value": "2023-03-15-preview"
    },
    {
        "identifier": "temperature",
        "label": "Sampling Temperature",
        "type": "string",
        "description": ">=0, <=2. Higher values will result in a more random output, and vice versa.",
        "default value": "0.7"
    },
    {
        "identifier": "opinionedActions",
        "label": "❤ OPINIONED ACTIONS",
        "type": "heading",
        "description": "Click while holding shift(⇧) to use the secondary language.",
    }
]

new Array(
    { name: "translate", primary: "English", secondary: "Chinese Simplified", defaultInstruction: DEFAULT_TRANSLATE_INSTRUCTION },
    { name: "slang", primary: "English", secondary: "Chinese Simplified", defaultInstruction: DEFAULT_SLANG_INSTRUCTION },
    // { name: "revise", primary: "English", secondary: "Chinese Simplified", defaultInstruction: DEFAULT_REVISE_INSTRUCTION },
    { name: "polish", primary: "English", secondary: "Chinese Simplified", defaultInstruction: DEFAULT_POLISH_INSTRUCTION },
    { name: "expand", primary: "English", secondary: "Chinese Simplified", defaultInstruction: DEFAULT_EXPAND_INSTRUCTION },
    { name: "summarize", primary: "English", secondary: "Chinese Simplified", defaultInstruction: DEFAULT_SUMMARIZE_INSTRUCTION },
    { name: "midjourney", primary: "English", secondary: "Chinese Simplified", defaultInstruction: DEFAULT_MIDJOURNEY_INSTRUCTION },
    { name: "stablediffusion", primary: "English", secondary: "Chinese Simplified", defaultInstruction: DEFAULT_STABLEDIFFUSION_INSTRUCTION },
    { name: "custom", primary: "English", secondary: "Chinese Simplified", defaultInstruction: DEFAULT_CUSTOM_INSTRUCTION },
).forEach((value) => {
    const capitalizedName = value.name.charAt(0).toUpperCase() + value.name.slice(1)
    chatGPTActionsOptions.push(
        {
            "identifier": value.name,
            "label": `${capitalizedName} Texts`,
            "type": "heading"
        },
        {
            
            "identifier": `${value.name}Enabled`,
            "label": "Enable",
            "type": "boolean",
            "inset": true
        })
    if (value.name !== "midjourney" && value.name !== "stablediffusion") {
        chatGPTActionsOptions.push(
            {
                "identifier": `${value.name}PrimaryLanguage`,
                "label": "Primary",
                "type": "multiple",
                "default value": `${value.primary}`,
                "values": optionLanguagesValues,
                "value labels": optionLanguagesValueLabels,
                "inset": true
            },
            {
                "identifier": `${value.name}SecondaryLanguage`,
                "label": "Secondary",
                "type": "multiple",
                "default value": `${value.secondary}`,
                "values": optionLanguagesValues,
                "value labels": optionLanguagesValueLabels,
                "inset": true
            })
    }
    if (value.name === "custom") {
        chatGPTActionsOptions.push({
            "identifier": `${value.name}Instruction`,
            "label": `${capitalizedName} Instruction`,
            "type": "string",
            "default value": value.defaultInstruction,
            "height": "auto",
            "white-space": "pre-wrap",
            "inset": false
        })
    }
})

export const options = chatGPTActionsOptions


