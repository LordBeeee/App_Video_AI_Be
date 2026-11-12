import { BadRequestException } from '@nestjs/common';

export interface ChatDocument {
  name: string;
  text: string;
}

export function chatDocuments(value: unknown): ChatDocument[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 3)
    throw new BadRequestException('Mỗi tin nhắn được đính kèm tối đa 3 tài liệu');
  let bytes = 0;
  return value.map((item) => {
    if (!item || typeof item.name !== 'string' || typeof item.text !== 'string' ||
        item.name.length > 200 || /[\x00-\x1f]/.test(item.name) || !/\.(pdf|txt|md|docx|xlsx)$/i.test(item.name) || !item.text.trim() ||
        item.text.includes('\0')) {
      throw new BadRequestException('Tài liệu không hợp lệ');
    }
    bytes += Buffer.byteLength(item.text, 'utf8');
    if (bytes > 60_000)
      throw new BadRequestException('Tổng nội dung tài liệu vượt 60 KB. Hãy chia nhỏ tài liệu.');
    return { name: item.name, text: item.text.trim() };
  });
}

export function chatContent(content: string, documents: ChatDocument[] = []) {
  if (!documents.length) return content;
  return JSON.stringify({
    question: content,
    reference_documents: documents,
  });
}

export async function extractChatDocument(file?: { originalname: string; buffer: Buffer }) {
  if (!file?.buffer?.length || file.buffer.length > 5 * 1024 * 1024)
    throw new BadRequestException('Chọn tài liệu tối đa 5 MB');
  // Multer decodes multipart filenames as latin1; browsers send UTF-8.
  const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const name = decodedName.includes('\ufffd') ? file.originalname : decodedName;
  let text: string;
  if (/\.pdf$/i.test(name)) {
    if (file.buffer.subarray(0, 5).toString() !== '%PDF-')
      throw new BadRequestException('Nội dung không phải PDF hợp lệ');
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: file.buffer });
    try {
      const info = await parser.getInfo();
      if (info.total > 40) throw new BadRequestException('PDF tối đa 40 trang');
      const result = await parser.getText();
      text = result.pages.map((page) => page.text).join('\n');
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Không đọc được PDF. Hãy kiểm tra file hoặc bỏ mật khẩu.');
    } finally {
      await parser.destroy();
    }
    if (!text.trim())
      throw new BadRequestException('PDF không có lớp chữ. File scan cần OCR, hiện chưa hỗ trợ.');
  } else if (/\.(docx|xlsx)$/i.test(name)) {
    if (file.buffer.subarray(0, 2).toString() !== 'PK')
      throw new BadRequestException('Nội dung không phải tài liệu Office hợp lệ');
    try {
      if (/\.docx$/i.test(name)) {
        const mammoth = await import('mammoth');
        text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
      } else {
        const { default: ExcelJS } = await import('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(file.buffer as any);
        const lines: string[] = [];
        let length = 0;
        for (const sheet of workbook.worksheets) {
          lines.push(`Sheet: ${sheet.name}`);
          sheet.eachRow((row, rowNumber) => {
            const cells: string[] = [];
            row.eachCell((cell) => cells.push(`${cell.address}: ${cell.text}`));
            const line = `${rowNumber}\t${cells.join('\t')}`;
            length += Buffer.byteLength(line);
            if (length > 60_000) throw new BadRequestException('Nội dung Excel vượt 60 KB. Hãy chia nhỏ bảng tính.');
            lines.push(line);
          });
        }
        text = lines.join('\n');
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Không đọc được tài liệu Office. Hãy kiểm tra file hoặc bỏ mật khẩu.');
    }
  } else if (/\.(txt|md)$/i.test(name)) {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    } catch {
      throw new BadRequestException('Tài liệu phải được lưu với mã hóa UTF-8');
    }
  } else {
    throw new BadRequestException('Chỉ hỗ trợ PDF, TXT, Markdown (.md), Word (.docx) và Excel (.xlsx)');
  }
  return chatDocuments([{ name, text }])[0];
}
