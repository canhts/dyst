
import { Component, signal, computed, inject, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService, VideoMetadata } from './services/ai.service';
import { APP_VERSION } from './version';

type DownloadType = 'mp4' | 'mp3';
type Platform = 'youtube' | 'tiktok' | 'unknown';
type AppState = 'idle' | 'analyzing' | 'waiting_for_save' | 'downloading' | 'converting' | 'completed' | 'error';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      color: #334155; /* Slate-700 */
    }
    
    /* Apple Liquid Glass Style */
    .glass-panel {
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(40px) saturate(200%);
      -webkit-backdrop-filter: blur(40px) saturate(200%);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-bottom: 1px solid rgba(255, 255, 255, 0.3);
      box-shadow: 
        0 20px 40px -10px rgba(15, 23, 42, 0.3),
        0 50px 100px -20px rgba(15, 23, 42, 0.15),
        inset 0 0 0 1px rgba(255, 255, 255, 0.2),
        inset 0 1px 20px 0 rgba(255, 255, 255, 0.4);
    }

    .glass-input {
      background: rgba(255, 255, 255, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.5);
      backdrop-filter: blur(10px);
      color: #1e293b;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.05);
    }
    .glass-input:focus {
      background: rgba(255, 255, 255, 0.85);
      border-color: rgba(139, 92, 246, 0.4);
      outline: none;
      box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.15), inset 0 1px 2px 0 rgba(0,0,0,0.05);
      transform: translateY(-1px);
    }
    .glass-input.error {
      border-color: rgba(239, 68, 68, 0.4);
      background: rgba(254, 226, 226, 0.4);
    }

    .glass-btn {
      background: rgba(255, 255, 255, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.6);
      transition: all 0.3s ease;
      backdrop-filter: blur(5px);
    }
    .glass-btn:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.6);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
    }

    .primary-glow {
      box-shadow: 0 10px 40px -10px rgba(139, 92, 246, 0.5);
    }
    
    .logo-float {
      animation: logoFloat 6s ease-in-out infinite;
    }
    @keyframes logoFloat {
      0%, 100% { transform: translateY(0px) scale(1); }
      50% { transform: translateY(-10px) scale(1.02); }
    }

    .install-prompt {
      animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    @keyframes slideUp {
      from { transform: translateY(100%); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `]
})
export class AppComponent {
  private aiService = inject(AiService);

  readonly appVersion = APP_VERSION.full;
  readonly copyright = APP_VERSION.copyright;

  @ViewChild('urlInput') urlInput!: ElementRef<HTMLInputElement>;

  // State Signals
  url = signal('');
  selectedType = signal<DownloadType>('mp4');
  state = signal<AppState>('idle');
  progress = signal(0);
  
  // Metadata Signals
  currentMetadata = signal<VideoMetadata | null>(null);
  
  deferredPrompt: any = null;
  showInstallButton = signal(false);
  errorMessage = signal('');

  // Internal Logic
  private fileHandle: any = null; // For File System Access API
  private abortController: AbortController | null = null; // To cancel fetch

  // Computed
  detectedPlatform = computed<Platform>(() => {
    const u = this.url().toLowerCase();
    if (!u) return 'unknown';
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
    if (u.includes('tiktok.com')) return 'tiktok';
    return 'unknown';
  });

  platformIcon = computed(() => {
    switch (this.detectedPlatform()) {
      case 'youtube': return 'fa-brands fa-youtube text-red-500';
      case 'tiktok': return 'fa-brands fa-tiktok text-pink-500';
      default: return 'fa-solid fa-cloud-arrow-down text-slate-400';
    }
  });

  formattedProgress = computed(() => `${Math.round(this.progress())}%`);
  
  statusText = computed(() => {
    switch(this.state()) {
      case 'analyzing': return 'Đang xử lý link...';
      case 'waiting_for_save': return 'Chọn nơi lưu file...';
      case 'downloading': return 'Đang tải dữ liệu thật...';
      case 'converting': return 'Đang hoàn tất...';
      case 'completed': return 'Đã xong!';
      case 'error': return 'Lỗi';
      default: return '';
    }
  });

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      this.showInstallButton.set(true);
    });
  }

  setType(type: DownloadType) {
    if (this.state() !== 'idle' && this.state() !== 'completed' && this.state() !== 'error') return;
    this.selectedType.set(type);
  }

  async pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) this.url.set(text);
    } catch (err) {
      this.urlInput?.nativeElement?.focus();
      this.showError('Quyền bị chặn. Dán thủ công.');
    }
  }

  reset() {
    this.state.set('idle');
    this.url.set('');
    this.currentMetadata.set(null);
    this.progress.set(0);
    this.errorMessage.set('');
    this.fileHandle = null;
    this.abortController = null;
    setTimeout(() => this.urlInput?.nativeElement?.focus(), 100);
  }

  async processLink() {
    if (!this.url()) return;
    if (this.detectedPlatform() === 'unknown' && !this.url().startsWith('http')) {
      this.showError('Link không hợp lệ.');
      return;
    }

    this.state.set('analyzing');
    this.progress.set(0);
    this.errorMessage.set('');
    this.currentMetadata.set(null);
    this.fileHandle = null;

    try {
      // 1. Phân tích AI & Lấy link thật
      const [aiMeta, directSource] = await Promise.all([
        this.aiService.analyzeLink(this.url(), this.selectedType()),
        this.aiService.getRealMediaSource(this.url(), this.selectedType())
      ]);

      const fullMeta = {
        ...aiMeta,
        directUrl: directSource.url,
        filename: directSource.filename
      };
      
      this.currentMetadata.set(fullMeta);
      
      // 2. Prompt lưu file
      await this.promptForSaveLocation(fullMeta);

    } catch (err: any) {
      console.error(err);
      this.showError(err.message || 'Lỗi xử lý video.');
    }
  }

  async promptForSaveLocation(metadata: VideoMetadata) {
    const extension = this.selectedType();
    // Ưu tiên tên file từ server nếu có, nếu không thì dùng tên từ AI
    const suggestedName = metadata.filename || `${metadata.title.substring(0, 30).replace(/[^a-z0-9]/gi, '_')}.${extension}`;

    if ('showSaveFilePicker' in window) {
      this.state.set('waiting_for_save');
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: suggestedName,
          types: [{
            description: extension === 'mp4' ? 'Video File' : 'Audio File',
            accept: { [extension === 'mp4' ? 'video/mp4' : 'audio/mpeg']: ['.' + extension] },
          }],
        });
        this.fileHandle = handle;
        this.startRealDownload(metadata.directUrl!);
      } catch (err: any) {
        if (err.name === 'AbortError') {
          this.state.set('idle'); 
        } else {
          // Fallback nếu user hủy hoặc lỗi API
          this.fileHandle = null;
          this.startRealDownload(metadata.directUrl!); 
        }
      }
    } else {
      // Mobile / Firefox: Tải trực tiếp vào thư mục Downloads
      this.startRealDownload(metadata.directUrl!);
    }
  }

  // --- Real Download Engine ---
  async startRealDownload(directUrl: string) {
    this.state.set('downloading');
    this.progress.set(0);
    this.abortController = new AbortController();

    try {
      // Fetch stream
      const response = await fetch(directUrl, {
        signal: this.abortController.signal
      });

      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
      if (!response.body) throw new Error('ReadableStream not supported');

      const contentLength = +(response.headers.get('Content-Length') || 0);
      const reader = response.body.getReader();

      let receivedLength = 0;
      const chunks = [];

      while(true) {
        const {done, value} = await reader.read();

        if (done) break;

        chunks.push(value);
        receivedLength += value.length;

        // Tính toán tiến trình
        if (contentLength > 0) {
          const percent = (receivedLength / contentLength) * 100;
          this.progress.set(Math.min(percent, 99.9));
        } else {
          // Fake progress nếu server không trả về Content-Length
          this.progress.update(p => Math.min(p + 1, 95)); 
        }
      }

      // Ghép chunks thành Blob
      this.state.set('converting');
      const blob = new Blob(chunks, { 
        type: this.selectedType() === 'mp4' ? 'video/mp4' : 'audio/mpeg' 
      });

      // Lưu file
      await this.saveFileToDisk(blob);

    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Download cancelled');
      } else {
        console.error('Download fail:', err);
        // Fallback: Mở tab mới nếu CORS chặn fetch blob
        window.open(directUrl, '_blank');
        this.finishState();
      }
    }
  }

  async saveFileToDisk(blob: Blob) {
    try {
      if (this.fileHandle) {
        const writable = await this.fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        // Legacy method
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const meta = this.currentMetadata();
        a.href = url;
        a.download = meta?.filename || `video.${this.selectedType()}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      this.finishState();
    } catch (e) {
      this.showError('Lỗi khi lưu file.');
    }
  }

  finishState() {
    this.progress.set(100);
    this.state.set('completed');
  }

  cancelDownload() {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.state.set('idle');
    this.progress.set(0);
    this.currentMetadata.set(null);
    this.fileHandle = null;
  }

  showError(msg: string) {
    this.errorMessage.set(msg);
    this.state.set('error');
    setTimeout(() => {
       if (this.state() === 'error') {
         this.state.set('idle');
         this.errorMessage.set('');
       }
    }, 4000);
  }

  installPwa() {
    if (this.deferredPrompt) {
      this.deferredPrompt.prompt();
      this.deferredPrompt.userChoice.then((choice: any) => {
        if (choice.outcome === 'accepted') {
          this.showInstallButton.set(false);
        }
        this.deferredPrompt = null;
      });
    }
  }
}
