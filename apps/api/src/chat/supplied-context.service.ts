import { BadGatewayException, BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ChatService, type ChatBudget } from './chat.service';
import {
  containsLikelyCredential, NO_CONTEXT_ANSWER, splitSuppliedContext, suppliedContextRequest, validateEvidenceSelection,
} from './supplied-context.policy';
import type { SuppliedPassage } from './supplied-context.policy';

export interface SuppliedContextAnswer {
  mode: 'supplied_context_extracts';
  status: 'evidence_selected' | 'not_found';
  content: string;
  sources: SuppliedPassage[];
  model: string;
  budget: ChatBudget;
}

@Injectable()
export class SuppliedContextService {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  prepareReference(context: string): SuppliedPassage[] {
    const parsed = suppliedContextRequest.shape.context.safeParse(context);
    if (!parsed.success || containsLikelyCredential(context)) throw new BadRequestException('Supply nonblank reference text up to 24,000 characters without credentials.');
    if (Array.from(context).some((character) => {
      const code = character.codePointAt(0)!;
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127 || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    })) throw new BadRequestException('Remove hidden control or text-direction characters.');
    try { return splitSuppliedContext(context); }
    catch { throw new BadRequestException('Use at most 40 passages with lines no longer than 1,200 characters.'); }
  }

  async selectPrepared(model: string, question: string, passages: readonly SuppliedPassage[], requestId: string): Promise<{ sources: SuppliedPassage[]; budget: ChatBudget }> {
    // Only application-owned adapters call this with already screened, permission-filtered passages.
    this.prepareReference(question);
    const completion = await this.chat.selectEvidence({ model, question, sources: passages }, requestId);
    try { return { sources: validateEvidenceSelection(completion.content, passages), budget: completion.budget }; }
    catch { throw new BadGatewayException('The model returned an invalid evidence selection. No answer was accepted.'); }
  }

  async answer(input: unknown, requestId: string): Promise<SuppliedContextAnswer> {
    const parsed = suppliedContextRequest.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Supply a model, a question (up to 2,000 characters), and reference text (up to 24,000 characters).');
    const { model, question, context } = parsed.data;
    if (containsLikelyCredential(context) || containsLikelyCredential(question)) {
      throw new BadRequestException('Possible credentials detected. Remove credentials before submitting reference text or questions.');
    }
    const hasHiddenControls = Array.from(context + question).some((character) => {
      const code = character.codePointAt(0)!;
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127
        || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    });
    if (hasHiddenControls) {
      throw new BadRequestException('Remove hidden control or text-direction characters from the reference and question.');
    }
    let passages: SuppliedPassage[];
    try {
      passages = splitSuppliedContext(context);
    } catch {
      throw new BadRequestException('Reference text must have at most 40 passages and no line longer than 1,200 characters. Split long lines or use a shorter reference.');
    }
    const completion = await this.chat.selectEvidence({ model, question, sources: passages }, requestId);
    let sources: SuppliedPassage[];
    try {
      sources = validateEvidenceSelection(completion.content, passages);
    } catch {
      // Never expose arbitrary model prose, forged quotations, or raw provider output in this mode.
      throw new BadGatewayException('The model returned an invalid evidence selection. No answer was accepted; retry or choose another available model.');
    }
    return {
      mode: 'supplied_context_extracts',
      status: sources.length ? 'evidence_selected' : 'not_found',
      content: sources.length
        ? sources.map((source) => `[${source.id}, lines ${source.lineStart}-${source.lineEnd}]\n${source.text}`).join('\n\n')
        : NO_CONTEXT_ANSWER,
      sources, model: completion.model, budget: completion.budget,
    };
  }
}
