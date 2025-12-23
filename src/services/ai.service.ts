
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
  // Đã cập nhật các instance mới nhất và ổn định
  // Việc có nhiều domain khác nhau giúp tránh IP Blocking từ phía Youtube/Tiktok
  private readonly SERVERS = [
    'https://cobalt.api.wuk.sh/api/json',       // Instance 1
    'https://cobalt.casply.com/api/json',       // Instance 2
    'https://api.server.social/api/json',       // Instance 3
    'https://api.opensource.wtf/api/json',      // Instance 4
    'https://cobalt.xyzen.dev/api/json',        // Instance 5
    'https://cobalt.aur1.st/api/json',          // Instance 6
    'https://k.joher.com/api/json',             // Instance 7
    'https://api.wwebs.co/api/json',            // Instance 8
    'https://cobalt.q1n.dev/api/json',          // Instance 9
    'https://dl.khub.win/api/json'              // Instance 10
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

    // CHIẾN LƯỢC TRÁNH IP BLOCKING & CÂN BẰNG TẢI:
    // Thay vì luôn bắt đầu từ server đầu tiên, chúng ta xáo trộn hoàn toàn danh sách server mỗi lần gọi.
    // Điều này đảm bảo request được phân tán đều ra các IP khác nhau của các server Cobalt.
    const serverList = [...this.SERVERS].sort(() => Math.random() - 0.5);

    const body = {
      url: cleanUrl,
      vCodec: 'h264',
      vQuality: '1080',
      aFormat: 'mp3',
      isAudioOnly: type === 'mp3',
      filenamePattern: 'basic',
      // Disable metadata để giảm tải xử lý cho server
      disableMetadata: true 
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
          credentials: 'omit'
        });

        clearTimeout(timeoutId);

        // Lỗi HTTP từ server (500, 502, 503...) -> Thử node khác
        if (!response.ok) {
           throw new Error(`HTTP_ERROR_${response.status}`);
        }

        const data = await response.json() as CobaltResponse;

        // Xử lý logic lỗi từ API Cobalt
        if (data.status === 'error') {
            const errText = (data.text || '').toLowerCase();
            
            // Nếu lỗi là do Link sai hoặc Private -> Dừng luôn, không thử server khác phí thời gian
            if (errText.includes('invalid url') || 
                errText.includes('private') || 
                errText.includes('doesn\'t exist')) {
                throw new Error('FATAL_INVALID_URL');
            }
            
            // Nếu lỗi là Rate limit hoặc server bận -> Thử server khác
            console.warn(`Node ${endpoint} busy/blocked:`, errText);
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
        
        // Trường hợp lạ: status ok nhưng không có url
        throw new Error('Empty response from node');

      } catch (error: any) {
        lastError = error;
        const msg = error.message || '';

        // Nếu là lỗi Fatal, ném lỗi ra ngoài ngay lập tức
        if (msg === 'FATAL_INVALID_URL') {
            throw new Error('Link không tồn tại hoặc quyền riêng tư.');
        }

        // Nếu là lỗi CORS (Failed to fetch) hoặc Timeout -> Log nhẹ và thử node tiếp theo
        // Đây chính là cách "Auto-Proxy" qua node khác
        continue;
      }
    }

    // Nếu chạy hết danh sách mà vẫn lỗi
    console.error('All nodes failed.', lastError);
    
    let userMessage = 'Hệ thống đang quá tải. ';
    const errStr = lastError?.toString().toLowerCase() || '';

    if (errStr.includes('fetch') || errStr.includes('network') || errStr.includes('typeerror')) {
      userMessage += 'Lỗi mạng (CORS). Vui lòng kiểm tra kết nối hoặc thử lại sau.';
    } else {
      userMessage += 'Không thể lấy link. Video có thể đã bị chặn IP hoặc xóa.';
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
