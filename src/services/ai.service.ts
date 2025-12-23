
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
  
  // Danh sách các server dự phòng (Mirrors) để tránh lỗi quá tải hoặc CORS
  private readonly SERVERS = [
    'https://api.cobalt.tools/api/json',      // Official (Main)
    'https://cobalt.api.wuk.sh/api/json',     // Mirror 1 (Reliable)
    'https://api.server.social/api/json',     // Mirror 2
    'https://cobalt.tools/api/json'           // Fallback
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

  // Bước 2: Lấy Link tải thật từ Server (Có cơ chế thử lại nhiều server)
  async getRealMediaSource(url: string, type: 'mp4' | 'mp3'): Promise<{ url: string, filename: string }> {
    let lastError: any = null;

    // Cấu hình request
    const body = {
      url: url,
      vCodec: 'h264',
      vQuality: '1080', // Cố gắng lấy 1080p
      aFormat: 'mp3',
      isAudioOnly: type === 'mp3',
      filenamePattern: 'basic'
    };

    // Vòng lặp thử từng server
    for (const endpoint of this.SERVERS) {
      try {
        console.log(`Trying server: ${endpoint}`);
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        const data = await response.json() as CobaltResponse;

        // Nếu server trả về lỗi cụ thể
        if (data.status === 'error') {
            console.warn(`Server ${endpoint} returned error:`, data.text);
            // Nếu lỗi là do limit hoặc processing, thử server khác. 
            // Nếu lỗi do link sai (invalid url), có thể dừng ngay, nhưng an toàn cứ thử hết.
            throw new Error(data.text || 'Server error');
        }
        
        // Xử lý trường hợp trả về picker (Youtube playlists hoặc multi-track)
        if (data.status === 'picker' && data.picker && data.picker.length > 0) {
          return { 
            url: data.picker[0].url, 
            filename: data.filename || `video.${type}`
          };
        }

        // Trường hợp stream/redirect thành công
        if (data.url) {
          return { 
            url: data.url, 
            filename: data.filename || `download.${type}` 
          };
        }
        
        throw new Error('No URL in response');

      } catch (error) {
        lastError = error;
        // Tiếp tục thử server tiếp theo trong vòng lặp
        continue;
      }
    }

    // Nếu thử hết tất cả server mà vẫn lỗi
    console.error('All servers failed:', lastError);
    throw new Error('Không thể tải video này. Link có thể là riêng tư, giới hạn độ tuổi hoặc hệ thống đang bận. Vui lòng thử lại sau.');
  }
}
