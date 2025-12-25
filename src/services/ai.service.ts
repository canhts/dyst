
import { Injectable, inject } from '@angular/core';
import { GoogleGenAI } from '@google/genai';

export interface VideoMetadata {
  title: string;
  author: string;
  estimatedSize: string;
  directUrl?: string; // Link tải thật
  filename?: string;
}

interface CobaltResponse {
  status: string;
  url?: string;
  filename?: string;
  picker?: any[];
  text?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AiService {
  private ai: GoogleGenAI | null = null;
  
  // Danh sách Server Cobalt (Mirrors)
  // Đã cập nhật: v1.0.18 - Thêm các server mới & server chính thức
  private readonly SERVERS = [
    'https://cobalt.api.wuk.sh/api/json',       // Stable
    'https://cobalt.casply.com/api/json',       // Stable
    'https://api.server.social/api/json',       // Stable
    'https://api.imp.xyz/api/json',             // New Stable
    'https://cobalt.xyzen.dev/api/json',        // Fast
    'https://cobalt.aur1.st/api/json',          // Fast
    'https://api.wwebs.co/api/json',            // Backup
    'https://cobalt.q1n.dev/api/json',          // Backup
    'https://dl.khub.win/api/json',             // Backup
    'https://cobalt.june07.com/api/json',       // Backup
    'https://api.cobalt.tools/api/json'         // Official (Strict but reliable)
  ];

  constructor() {
    try {
      this.ai = new GoogleGenAI({ apiKey: process.env['API_KEY'] || '' });
    } catch (e) {
      console.error('AI initialization failed', e);
    }
  }

  // Bước 1: Dùng AI để phân tích ngữ nghĩa
  async analyzeLink(url: string, type: 'mp4' | 'mp3'): Promise<VideoMetadata> {
    const fallback: VideoMetadata = {
      title: 'Đang tải dữ liệu...',
      author: 'Unknown Source',
      estimatedSize: 'Calculating...'
    };

    if (!this.ai) return fallback;

    try {
      const prompt = `Analyze this video URL: "${url}".
      Use Google Search to find the REAL Title and Channel Name.
      Output format: TITLE: <text> ||| AUTHOR: <text>
      If unknown, guess from URL text.`;

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { tools: [{googleSearch: {}}] }
      });

      const text = response.text || '';
      const titleMatch = text.match(/TITLE:\s*(.*?)\s*\|\|\|/);
      const authorMatch = text.match(/AUTHOR:\s*(.*)/);

      return {
        title: titleMatch ? titleMatch[1].trim() : 'Video Content',
        author: authorMatch ? authorMatch[1].trim() : 'Detected Source',
        estimatedSize: 'Checking...'
      };

    } catch (error) {
      return fallback;
    }
  }

  // Bước 2: Lấy Link tải thật từ Server
  async getRealMediaSource(url: string, type: 'mp4' | 'mp3'): Promise<{ url: string, filename: string }> {
    let lastError: any = null;

    // Làm sạch URL
    const cleanUrl = this.cleanUrl(url);

    // Chiến lược: Random hóa danh sách server để cân bằng tải và tránh IP blocking
    const serverList = [...this.SERVERS].sort(() => Math.random() - 0.5);

    const body = {
      url: cleanUrl,
      vCodec: 'h264',
      vQuality: '1080',
      aFormat: 'mp3',
      isAudioOnly: type === 'mp3',
      filenamePattern: 'basic'
      // Đã xóa disableMetadata để tăng tương thích với các server bản cũ
    };

    // Thử lần lượt các server
    for (const endpoint of serverList) {
      try {
        console.log(`Connecting to node: ${endpoint}`);
        
        // Timeout 15s
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: controller.signal,
          mode: 'cors',
          credentials: 'omit',
          referrerPolicy: 'no-referrer' // Quan trọng: Ẩn nguồn gốc request
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
           throw new Error(`HTTP_ERROR_${response.status}`);
        }

        const data = await response.json() as CobaltResponse;

        // Xử lý logic lỗi từ API Cobalt
        if (data.status === 'error') {
            const errText = (data.text || '').toLowerCase();
            
            // Lỗi Fatal: Link sai, Private, Deleted -> Dừng ngay
            if (errText.includes('invalid url') || 
                errText.includes('private') || 
                errText.includes('doesn\'t exist') ||
                errText.includes('deleted')) {
                throw new Error('FATAL_INVALID_URL');
            }
            
            // Các lỗi còn lại (busy, rate limit, processing error) -> Thử server tiếp
            console.warn(`Node ${endpoint} returned error:`, errText);
            throw new Error(data.text);
        }
        
        // Success Case 1: Picker (Playlist/Multi-track)
        if (data.status === 'picker' && data.picker && data.picker.length > 0) {
          return { 
            url: data.picker[0].url, 
            filename: data.filename || `video.${type}`
          };
        }

        // Success Case 2: Direct URL
        if (data.url) {
          return { 
            url: data.url, 
            filename: data.filename || `download.${type}` 
          };
        }
        
        throw new Error('Empty response from node');

      } catch (error: any) {
        lastError = error;
        const msg = error.message || '';

        // Nếu là lỗi Fatal, ném lỗi ra ngoài ngay lập tức
        if (msg === 'FATAL_INVALID_URL') {
            throw new Error('Link không tồn tại, riêng tư hoặc đã bị xóa.');
        }

        // Tiếp tục thử server tiếp theo
        continue;
      }
    }

    // Nếu chạy hết danh sách mà vẫn lỗi
    console.error('All nodes failed.', lastError);
    
    let userMessage = 'Hệ thống đang quá tải. ';
    const errStr = lastError?.toString().toLowerCase() || '';

    if (errStr.includes('fetch') || errStr.includes('network') || errStr.includes('typeerror')) {
      userMessage += 'Lỗi kết nối tới máy chủ (CORS). Vui lòng thử lại sau vài giây.';
    } else {
      userMessage += 'Không thể xử lý link này. Vui lòng kiểm tra lại link.';
    }
    
    throw new Error(userMessage);
  }

  private cleanUrl(url: string): string {
    try {
      const u = new URL(url);
      if (u.hostname.includes('youtube') || u.hostname.includes('youtu.be')) {
        return url; 
      }
      if (u.hostname.includes('tiktok')) {
        return u.origin + u.pathname; 
      }
      return url;
    } catch {
      return url;
    }
  }
}
