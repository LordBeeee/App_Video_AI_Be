import { BadRequestException } from '@nestjs/common';
import { chatContent, chatDocuments, extractChatDocument } from './chat-documents';

describe('chat documents', () => {
  it('keeps extracted document text alongside the question', () => {
    const docs = chatDocuments([{ name: 'notes.md', text: '  Revenue: 120  ' }]);
    expect(JSON.parse(chatContent('What was revenue?', docs))).toEqual({
      question: 'What was revenue?',
      reference_documents: [{ name: 'notes.md', text: 'Revenue: 120' }],
    });
    expect(chatContent('Hello')).toBe('Hello');
  });

  it('limits document count and total UTF-8 size', () => {
    expect(() => chatDocuments(Array(4).fill({ name: 'a.txt', text: 'a' }))).toThrow(BadRequestException);
    expect(() => chatDocuments([{ name: 'a.txt', text: 'a'.repeat(30001) },
      { name: 'b.txt', text: 'b'.repeat(30000) }])).toThrow(BadRequestException);
  });

  it('rejects empty documents, binary text and unsupported extensions', async () => {
    expect(() => chatDocuments([{ name: 'a.txt', text: ' ' }])).toThrow(BadRequestException);
    await expect(extractChatDocument({ originalname: 'a.txt', buffer: Buffer.from([0xff]) }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(extractChatDocument({ originalname: 'a.exe', buffer: Buffer.from('test') }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(extractChatDocument({ originalname: 'a.pdf', buffer: Buffer.from('not a pdf') }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('extracts UTF-8 text for attachment previews and pricing', async () => {
    await expect(extractChatDocument({ originalname: 'notes.md', buffer: Buffer.from('Xin chào') }))
      .resolves.toEqual({ name: 'notes.md', text: 'Xin chào' });
  });
});
