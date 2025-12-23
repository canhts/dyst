
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
  // Sử dụng API public của Cobalt (công cụ tải media open-source tốt nhất hiện nay)
  private readonly API_ENDPOINT = 'https://api.cobalt.tools/api/json';

  constructor() {
    try {
      this.ai = new GoogleGenAI({ apiKey: process.env['API_KEY'] || '' });
    } catch (e) {
      console.error('AI initialization failed', e);
    }
  }

  // Bước 1: Dùng AI để phân tích ngữ nghĩa (như cũ) và lấy metadata hiển thị đẹp
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
      const authorMatch = text.match(/AUTHOR:\s*(.*)/); // Adjusted regex

      return {
        title: titleMatch ? titleMatch[1].trim() : 'Video Content',
        author: authorMatch ? authorMatch[1].trim() : 'Detected Source',
        estimatedSize: 'Checking...' // Sẽ update sau khi lấy link thật
      };

    } catch (error) {
      return fallback;
    }
  }

  // Bước 2: Lấy Link tải thật từ Server
  async getRealMediaSource(url: string, type: 'mp4' | 'mp3'): Promise<{ url: string, filename: string }> {
    try {
      const body = {
        url: url,
        vCodec: 'h264',
        vQuality: '1080',
        aFormat: 'mp3',
        isAudioOnly: type === 'mp3',
        filenamePattern: 'basic'
      };

      const response = await fetch(this.API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const data = await response.json() as CobaltResponse;

      if (data.status === 'error' || !data.url) {
        throw new Error(data.text || 'Không tìm thấy media');
      }

      // Nếu API trả về danh sách (picker), lấy cái đầu tiên
      if (data.status === 'picker' && data.picker && data.picker.length > 0) {
        return { 
          url: data.picker[0].url, 
          filename: data.filename || `video.${type}`
        };
      }

      return { 
        url: data.url, 
        filename: data.filename || `download.${type}` 
      };

    } catch (error) {
      console.error('Download API Error:', error);
      throw new Error('Không thể lấy link tải. Link có thể là riêng tư hoặc bị chặn.');
    }
  }
}
