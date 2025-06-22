import {
  GoogleGenAI,
  LiveServerMessage,
  MediaResolution,
  Modality,
  Session,
  GenerateContentResponse,
  GoogleGenAIOptions
} from '@google/genai';

import { marked } from "marked";
import { WaveFile } from "wavefile";
//import {Buffer} from "node:buffer";
// import { Buffer } from 'buffer';

// import pkg from 'wavefile';  // npm install wavefile
// const { WaveFile } = pkg;

// Define a minimal interface for _WaveFileFmt and _WaveFileData if not exposed by the library's types



interface ParsedAudioMimeType {
  sampleRate: number;
  bitsPerSample: number;
  channels: number;
  format?: string; // e.g., 'L16'
  rawFormat?: string; // e.g., 'l16'
}

export class DictationApp {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private genAI: GoogleGenAI;

  private polishedNoteElement: HTMLElement;
  private rawTranscriptionElement: HTMLElement;
  private recordButton: HTMLButtonElement;
  private recordButtonInner: HTMLElement;
  private recordingStatusElement: HTMLElement;
  private editorTitleElement: HTMLElement;
  private liveWaveformCanvas: HTMLCanvasElement;
  private liveWaveformContext: CanvasRenderingContext2D | null = null;
  private liveRecordingTitleElement: HTMLElement;
  private liveRecordingTimerDisplayElement: HTMLElement;
  private recordingInterfaceElement: HTMLElement;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private waveformDataArray: Uint8Array | null = null;
  private waveformAnimationId: number | null = null;
  private recordingStartTime: number = 0;
  private timerIntervalId: number | null = null;
  private GEMINI_API_KEY: string | undefined = undefined;
  private GEMINI_BASE_URL: string | undefined = undefined;

  // Dialog related properties
  private dialogAI: GoogleGenAI;
  // private base64Wav: string | undefined = undefined; // Retained if used for other purposes, though not directly in sendDialogMessage now
  // private base64PCM: string | undefined = undefined;
  private monoFloat32Data: Float32Array | undefined = undefined;
  private dialogSession: Session | undefined = undefined;
  private isDialogSessionConnected = false;
  private currentDialogAudioParts: string[] = [];
  private currentDialogAudioMimeType: string | undefined = undefined;

  private dialogDemoConnectButton: HTMLButtonElement;
  // private dialogDemoStatusElement: HTMLElement;
  private dialogDemoMessagesContainer: HTMLElement;
  private dialogDemoInputElement: HTMLInputElement;
  private dialogDemoSendButton: HTMLButtonElement;


  constructor() {
    const gemini_api = localStorage.getItem("gemini_api");
    const gemini_url = localStorage.getItem("gemini_url");
    if (!gemini_api || !gemini_url) {
      alert("gemini_api is not define");
      // window.location.href = "/";
      return;

    }
    this.GEMINI_API_KEY = gemini_api;
    this.GEMINI_BASE_URL = gemini_url;

    const ai_config:GoogleGenAIOptions =
    {
      apiKey: this.GEMINI_API_KEY,
      httpOptions: {
        baseUrl: this.GEMINI_BASE_URL
      }
    }
      ;

    this.genAI = new GoogleGenAI(ai_config);
    this.dialogAI = new GoogleGenAI(ai_config); // Separate instance if needed, or reuse


    this.polishedNoteElement = document.getElementById("polishedNote")!;
    this.rawTranscriptionElement = document.getElementById("rawTranscription")!;
    this.recordButton = document.getElementById("recordButton") as HTMLButtonElement;
    this.recordButtonInner = this.recordButton.querySelector(".record-button-inner")!;
    this.recordingStatusElement = document.getElementById("recordingStatus")!;
    this.editorTitleElement = document.querySelector(".editor-title")!;
    this.liveWaveformCanvas = document.getElementById("liveWaveformCanvas") as HTMLCanvasElement;
    this.liveRecordingTitleElement = document.getElementById("liveRecordingTitle")!;
    this.liveRecordingTimerDisplayElement = document.getElementById("liveRecordingTimerDisplay")!;
    this.recordingInterfaceElement = document.querySelector(".recording-interface")!;


    // Dialog Demo UI Elements
    this.dialogDemoConnectButton = document.getElementById("dialogDemoConnectButton") as HTMLButtonElement;
    // this.dialogDemoStatusElement = document.getElementById("dialogDemoStatus")!;
    this.dialogDemoMessagesContainer = document.getElementById("dialogDemoMessagesContainer")!;
    this.dialogDemoInputElement = document.getElementById("dialogDemoInput") as HTMLInputElement;
    this.dialogDemoSendButton = document.getElementById("dialogDemoSendButton") as HTMLButtonElement;

    this.init();
    this.initDialogDemo();
  }
  //@ts-ignore
  private connectGemini() {

  }

  private init() {
    this.recordButton.addEventListener("click", () => this.toggleRecording());
    this.setupContentEditablePlaceholder(this.polishedNoteElement);
    this.setupContentEditablePlaceholder(this.rawTranscriptionElement);
    this.setupContentEditablePlaceholder(this.editorTitleElement, true);


    document.getElementById("themeToggleButton")?.addEventListener("click", () => {
      document.body.classList.toggle("light-mode");
      const icon = document.getElementById("themeToggleButton")?.querySelector("i");
      if (icon) {
        icon.classList.toggle("fa-sun");
        icon.classList.toggle("fa-moon");
      }
      this.drawLiveWaveform(); // Redraw waveform if visible, in case colors changed
    });

    document.getElementById("newButton")?.addEventListener("click", () => {
      this.polishedNoteElement.innerHTML = "";
      this.rawTranscriptionElement.innerHTML = "";
      this.editorTitleElement.textContent = "Untitled Note";
      this.setupContentEditablePlaceholder(this.polishedNoteElement);
      this.setupContentEditablePlaceholder(this.rawTranscriptionElement);
      this.setupContentEditablePlaceholder(this.editorTitleElement, true);
      this.updateStatus("Ready to record");
    });

    if (this.liveWaveformCanvas) {
      this.liveWaveformContext = this.liveWaveformCanvas.getContext("2d");
    }
  }

  private initDialogDemo() {
    this.dialogDemoConnectButton.addEventListener("click", () => this.toggleDialogConnection());
    this.dialogDemoSendButton.addEventListener("click", () => this.sendMessageToDialog());
    this.dialogDemoInputElement.addEventListener("keypress", (event) => {
      if (event.key === "Enter" && !this.dialogDemoSendButton.disabled) {
        this.sendMessageToDialog();
      }
    });
    this.updateDialogUIState();
  }

  private async toggleDialogConnection() {
    if (this.isDialogSessionConnected && this.dialogSession) {
      this.disconnectFromDialog();
    } else {
      await this.connectToDialog();
    }
  }

  private async connectToDialog() {
    this.updateDialogStatus("Connecting...");
    this.dialogDemoConnectButton.disabled = true;

    try {
      const dialogConfigForLive = {
        responseModalities: [
          Modality.AUDIO,
        ],
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Zephyr',
            }
          }
        },
        contextWindowCompression: {
          triggerTokens: '25600',
          slidingWindow: { targetTokens: '12800' },
        },
      };

      this.dialogSession = await this.dialogAI.live.connect({
        model: 'gemini-2.5-flash-preview-native-audio-dialog', // Model from the demo
        config: dialogConfigForLive,
        callbacks: {
          onopen: () => {
            this.isDialogSessionConnected = true;
            this.updateDialogStatus("Connected");
            this.addDialogMessageToUI("System: Connection opened.", 'system');
            this.updateDialogUIState();
            this.dialogDemoConnectButton.disabled = false;
          },
          onmessage: (message: LiveServerMessage) => {
            this.handleDialogMessageFromServer(message);
          },
          onerror: (e: ErrorEvent) => {
            console.error("Dialog_Error:", e);
            this.updateDialogStatus(`Error: ${e.message}`);
            this.addDialogMessageToUI(`System: Error - ${e.message}`, 'system');
            this.isDialogSessionConnected = false;
            this.updateDialogUIState();
            this.dialogDemoConnectButton.disabled = false;

          },
          onclose: (e: CloseEvent) => {
            this.isDialogSessionConnected = false;
            this.updateDialogStatus("Disconnected.");
            this.addDialogMessageToUI(`System: Connection closed. Reason: ${e.reason || 'Unknown'}`, 'system');
            this.updateDialogUIState();
            this.dialogSession = undefined;
            this.dialogDemoConnectButton.disabled = false;
          },
        },
      });
      this.dialogSession.sendClientContent({
        turns: [{ text: "You are an IELTS speaking coach." }]

      }
      );


    } catch (error) {
      console.error("Failed to connect to dialog session:", error);
      this.updateDialogStatus(`Connection failed: ${(error as Error).message}`);
      this.addDialogMessageToUI(`System: Connection failed - ${(error as Error).message}`, 'system');
      this.isDialogSessionConnected = false;
      this.updateDialogUIState();
      this.dialogDemoConnectButton.disabled = false;
    }
  }

  private disconnectFromDialog() {
    if (this.dialogSession) {
      this.dialogSession.close();
      // onclose callback will handle state updates
    }
  }
  // @ts-ignore

  private pcmToWav(pcmBuffer: ArrayBuffer, sampleRate = 16000, numChannels = 1): ArrayBuffer {
    const pcmBytes = new Uint8Array(pcmBuffer);
    const byteRate = sampleRate * numChannels * 2; // 16-bit = 2 bytes per sample
    const blockAlign = numChannels * 2;
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + pcmBytes.length, true);     // ChunkSize
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);                      // Subchunk1Size (PCM)
    view.setUint16(20, 1, true);                       // AudioFormat (1 = PCM)
    view.setUint16(22, numChannels, true);             // NumChannels
    view.setUint32(24, sampleRate, true);              // SampleRate
    view.setUint32(28, byteRate, true);                // ByteRate
    view.setUint16(32, blockAlign, true);              // BlockAlign
    view.setUint16(34, 16, true);                      // BitsPerSample
    writeString(36, 'data');
    view.setUint32(40, pcmBytes.length, true);         // Subchunk2Size

    // Combine header and PCM data
    const wavBytes = new Uint8Array(44 + pcmBytes.length);
    wavBytes.set(new Uint8Array(wavHeader), 0);
    wavBytes.set(pcmBytes, 44);

    return wavBytes.buffer;
  }

  private async sendMessageToDialog() {
    const messageText = this.dialogDemoInputElement.value.trim();

    if ((!messageText && !this.monoFloat32Data) || !this.dialogSession || !this.isDialogSessionConnected) {
      if (!this.monoFloat32Data && !messageText) {
        console.log("sendMessageToDialog: Nothing to send (no text, no recorded audio).");
      }
      return;
    }

    if (messageText) {
      console.log(`sendMessageToDialog: Sending text: "${messageText}"`);
      this.dialogSession.sendClientContent({
        turns: [{ text: messageText }]
      });
      this.addDialogMessageToUI(messageText, 'user');
      this.dialogDemoInputElement.value = "";
    }

    if (this.monoFloat32Data) {
      try {


        this.dialogSession.sendRealtimeInput({ media: this.createBlob(this.monoFloat32Data) });
        this.monoFloat32Data = undefined; // Clear the audio data after sending
        // console.log("sendMessageToDialog: Realtime audio input sent.");
        this.addDialogMessageToUI("[Audio sent by you]", 'user');
      } catch (error) {
        console.error("sendMessageToDialog: Error sending realtime audio input:", error);
        this.addDialogMessageToUI(`System: Error sending audio - ${(error as Error).message}`, 'system');
      } finally {
        // this.base64PCM was already cleared or not used directly; this.monoFloat32Data is now cleared
        // console.log("sendMessageToDialog: Cleared this.monoFloat32Data.");
      }
    }
  }

  private handleDialogMessageFromServer(message: LiveServerMessage) {
    // console.log("Dialog_Message_RAW:", JSON.stringify(message, null, 2));
    if (message.serverContent?.modelTurn?.parts) {
      message.serverContent.modelTurn.parts.forEach(part => {
        if (part.text) {
          this.addDialogMessageToUI(part.text, 'model');
        }
        if (part.inlineData?.data) {
          this.currentDialogAudioParts.push(part.inlineData.data);
          if (!this.currentDialogAudioMimeType && part.inlineData.mimeType) {
            this.currentDialogAudioMimeType = part.inlineData.mimeType;
          }
        }
      });
    }

    if (message.serverContent?.turnComplete) {
      if (this.currentDialogAudioParts.length > 0 && this.currentDialogAudioMimeType) {
        const fullAudioData = this.currentDialogAudioParts.join('');
        this.playDialogAudio(fullAudioData, this.currentDialogAudioMimeType);
        this.currentDialogAudioParts = [];
        this.currentDialogAudioMimeType = undefined;
      }
    }
  }

  private parseDialogAudioMimeType(mimeType: string): ParsedAudioMimeType {
    const result: ParsedAudioMimeType = { channels: 1, bitsPerSample: 16, sampleRate: 16000 }; // Sensible defaults
    const parts = mimeType.toLowerCase().split(';');
    const formatPart = parts[0].split('/')[1];

    if (formatPart) {
      result.rawFormat = formatPart;
      result.format = formatPart.toUpperCase();
      if (formatPart.startsWith('l')) { // e.g. L8, L16, L24, L32
        const bits = parseInt(formatPart.substring(1), 10);
        if (!isNaN(bits)) {
          result.bitsPerSample = bits;
        }
      }
    }

    parts.slice(1).forEach(param => {
      const [key, value] = param.split('=').map(s => s.trim());
      if (key === 'rate' && value) {
        const rate = parseInt(value, 10);
        if (!isNaN(rate)) result.sampleRate = rate;
      } else if (key === 'channels' && value) {
        const channels = parseInt(value, 10);
        if (!isNaN(channels)) result.channels = channels;
      }
    });
    return result;
  }

  private async playDialogAudio(base64AudioData: string, mimeType: string) {
    try {
      const parsedMime = this.parseDialogAudioMimeType(mimeType);
      if (!parsedMime.sampleRate) {
        console.error("Dialog Audio: Sample rate missing in MIME type", mimeType);
        this.addDialogMessageToUI(`System: Error - Could not play audio, sample rate unknown. MIME: ${mimeType}`, 'system');
        return;
      }

      // Decode base64 to Uint8Array
      const binaryString = atob(base64AudioData);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const wav = new WaveFile();
      let samples;
      let bitDepthString: '8' | '16' | '24' | '32' | '32f' | '64' = '16';

      switch (parsedMime.bitsPerSample) {
        case 8:
          samples = bytes; // Or new Int8Array(bytes.buffer) if signed PCM8
          bitDepthString = '8';
          break;
        case 16:
          samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
          bitDepthString = '16';
          break;
        case 24:
          console.warn("Dialog Audio: 24-bit audio might not be fully supported by WaveFile lib, attempting '32'.");
          samples = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4); // Assuming Int32 for simplicity
          bitDepthString = '32';
          break;
        case 32:
          if (parsedMime.rawFormat === 'l32f') {
            samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
            bitDepthString = '32f';
          } else {
            samples = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
            bitDepthString = '32';
          }
          break;
        default:
          console.error(`Dialog Audio: Unsupported bit depth ${parsedMime.bitsPerSample}`);
          this.addDialogMessageToUI(`System: Error - Unsupported audio bit depth: ${parsedMime.bitsPerSample}`, 'system');
          return;
      }

      wav.fromScratch(parsedMime.channels || 1, parsedMime.sampleRate, bitDepthString, samples);
      const audioUrl = wav.toDataURI();

      const audioElement = document.createElement('audio');
      audioElement.controls = true;
      audioElement.src = audioUrl;
      audioElement.setAttribute('aria-label', 'Model audio response');


      const messageDiv = document.createElement('div');
      messageDiv.classList.add('dialog-message', 'model'); // Audio is always from model in this context
      messageDiv.appendChild(audioElement);
      this.dialogDemoMessagesContainer.appendChild(messageDiv);
      this.dialogDemoMessagesContainer.scrollTop = this.dialogDemoMessagesContainer.scrollHeight;

    } catch (error) {
      console.error("Error playing dialog audio:", error);
      this.addDialogMessageToUI(`System: Error playing audio - ${(error as Error).message}`, 'system');
    }
  }


  private addDialogMessageToUI(text: string, sender: 'user' | 'model' | 'system') {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('dialog-message', sender);

    // Sanitize and parse markdown.
    // Use marked.parse() for block-level elements too.
    // For "system" messages, we might not want markdown parsing if they are simple status texts.
    if (sender === 'user' || sender === 'model') {
      messageDiv.innerHTML = marked.parse(text) as string;
    } else {
      messageDiv.textContent = text; // Keep system messages as plain text
    }

    // Apply text-align based on sender *after* content is set if markdown might create block elements
    if (sender === 'user') {
      messageDiv.style.textAlign = "right"; // This might be overridden by internal p tags from markdown
    } else {
      messageDiv.style.textAlign = "left";
    }
    if (sender === 'system') {
      messageDiv.style.textAlign = "center";
    }


    this.dialogDemoMessagesContainer.appendChild(messageDiv);
    this.dialogDemoMessagesContainer.scrollTop = this.dialogDemoMessagesContainer.scrollHeight;
  }

  private updateDialogStatus(status: string) {
    this.addDialogMessageToUI(`updateDialogStatus:${status}`, "system")
    // this.dialogDemoStatusElement.textContent = status;
  }

  private updateDialogUIState() {
    if (this.isDialogSessionConnected) {
      // this.dialogDemoConnectButton.textContent = "Disconnect";
      this.dialogDemoConnectButton.style.color = "green";
      // this.dialogDemoConnectButton.style.backgroundColor = "green";
      this.dialogDemoInputElement.disabled = false;
      this.dialogDemoSendButton.disabled = false;
    } else {
      // this.dialogDemoConnectButton.textContent = "Connect";
      this.dialogDemoConnectButton.style.color = "red";
      // this.dialogDemoConnectButton.style.backgroundColor = "none";

      this.dialogDemoInputElement.disabled = true;
      this.dialogDemoSendButton.disabled = true;
    }
  }


  private setupContentEditablePlaceholder(element: HTMLElement, isTitle = false) {
    const placeholder = element.getAttribute("placeholder") || "";
    if (!placeholder) return;

    const updatePlaceholder = () => {
      if (element.textContent?.trim() === "") {
        if (isTitle && element.classList.contains('editor-title')) {
          if (element.textContent !== placeholder) element.textContent = placeholder;
        }
        element.classList.add("placeholder-active");
      } else {
        element.classList.remove("placeholder-active");
      }
    };

    element.addEventListener("focus", () => {
      if (element.textContent === placeholder && element.classList.contains("placeholder-active")) {
        if (!isTitle) element.textContent = ""; // Keep placeholder for title on focus unless user types
        // For non-title, removing placeholder-active happens on input or if content exists
      }
      // Always remove placeholder-active on focus if it's not the actual placeholder content for titles
      if (element.textContent !== placeholder || !isTitle) {
        element.classList.remove("placeholder-active");
      }
    });

    element.addEventListener("blur", () => {
      if (element.textContent?.trim() === "") {
        element.textContent = placeholder; // Reset to placeholder if empty
        element.classList.add("placeholder-active");
      }
      if (element.id === 'polishedNote' || element.id === 'rawTranscription' || element.classList.contains('editor-title')) {
        localStorage.setItem(element.id || 'editorTitle', element.innerHTML);
      }
    });

    element.addEventListener('input', () => {
      // If user types anything (even if it makes it empty again), it's not a placeholder
      if (element.textContent !== placeholder) {
        element.classList.remove('placeholder-active');
      }
      // If user clears the input, blur will handle resetting it to placeholder
    });

    const savedContent = localStorage.getItem(element.id || (isTitle ? 'editorTitle' : ''));
    if (savedContent && savedContent.trim() !== "" && savedContent !== `<p>${placeholder}</p>` && savedContent !== placeholder) {
      element.innerHTML = savedContent;
      element.classList.remove("placeholder-active");
    } else {
      element.textContent = placeholder;
      element.classList.add("placeholder-active");
    }
    updatePlaceholder(); // Initial check
  }


  private async toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  private createBlob(data: Float32Array) {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      // Convert float32 -1 to 1 to int16 -32768 to 32767
      // Clamp the scaled value to prevent overflow.
      const val = data[i] * 32768.0;
      int16[i] = Math.max(-32768, Math.min(32767, val));
    }

    return {
      data: this.encode(new Uint8Array(int16.buffer)),
      mimeType: 'audio/pcm;rate=16000',
    };
  }
  // @ts-ignore
  private decode(base64: string) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  private encode(bytes: Uint8Array) {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private async convertToPCM(audioBlob: Blob, targetSampleRate: number): Promise<ArrayBuffer> {
    const audioContext = new AudioContext();
    const arrayBuffer = await audioBlob.arrayBuffer();

    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    if (audioBuffer.numberOfChannels > 0) {
      const originalFloat32Data = audioBuffer.getChannelData(0);
      let originalMaxAmplitude = 0;
      for (let i = 0; i < Math.min(originalFloat32Data.length, 100); i++) {
        originalMaxAmplitude = Math.max(originalMaxAmplitude, Math.abs(originalFloat32Data[i]));
      }
      // console.log("Debug: Original AudioBuffer (Float32) - First 10 samples:", Array.from(originalFloat32Data.slice(0, 10)));
      // console.log("Debug: Original AudioBuffer (Float32) - Max Amplitude (first 100):", originalMaxAmplitude);
    }

    // const originalSampleRate = audioBuffer.sampleRate;
    // const originalChannels = audioBuffer.numberOfChannels;
    const originalDuration = audioBuffer.duration;

    // console.log(`convertToPCM: Original - SR: ${originalSampleRate}, Ch: ${originalChannels}, Dur: ${originalDuration.toFixed(2)}s`);
    // console.log(`convertToPCM: Resampling/mixing. Original SR: ${originalSampleRate}Hz, Ch: ${originalChannels}. Target SR: ${targetSampleRate}Hz, Mono.`);

    const offlineContext = new OfflineAudioContext(
      1,
      Math.ceil(originalDuration * targetSampleRate),
      targetSampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start(0);

    const resampledBuffer = await offlineContext.startRendering();

    const monoFloat32Data = resampledBuffer.getChannelData(0);
    this.monoFloat32Data = monoFloat32Data; // Store for Dialog sending
    // console.log("First 10 Float32 samples:", Array.from(monoFloat32Data.slice(0, 10)));
    // console.log("convertToPCM: Mono Float32 data length:", monoFloat32Data.length);

    const SILENCE_THRESHOLD = 0.01;

    let firstNonSilentSample = -1;
    for (let i = 0; i < monoFloat32Data.length; i++) {
      if (Math.abs(monoFloat32Data[i]) > SILENCE_THRESHOLD) {
        firstNonSilentSample = i;
        break;
      }
    }

    let processedFloat32Data: Float32Array;
    if (firstNonSilentSample > 0) {
      console.log(`Detected leading silence. Trimming ${firstNonSilentSample} samples.`);
      processedFloat32Data = monoFloat32Data.slice(firstNonSilentSample);
    } else {
      processedFloat32Data = monoFloat32Data;
    }
    const amplificationFactor = 1.0;
    for (let i = 0; i < processedFloat32Data.length; i++) {
      processedFloat32Data[i] *= amplificationFactor;
      processedFloat32Data[i] = Math.max(-1.0, Math.min(1.0, processedFloat32Data[i]));
    }


    // console.log("Debug: Processed Float32 data length (after trimming):", processedFloat32Data.length);
    // console.log("Debug: Processed Float32 - First 10 samples (after trimming):", Array.from(processedFloat32Data.slice(0, 10)));

    let processedMaxAmplitude = 0;
    for (let i = 0; i < Math.min(processedFloat32Data.length, 100); i++) {
      processedMaxAmplitude = Math.max(processedMaxAmplitude, Math.abs(processedFloat32Data[i]));
    }
    // console.log("Debug: Processed Float32 - Max Amplitude (first 100, after trimming):", processedMaxAmplitude);

    const pcmInt16Data = new Int16Array(processedFloat32Data.length);
    let int16Min = 0;
    let int16Max = 0;

    for (let i = 0; i < processedFloat32Data.length; i++) {
      let sample = processedFloat32Data[i];
      if (isNaN(sample)) sample = 0;
      sample = Math.max(-1, Math.min(1, sample));
      pcmInt16Data[i] = Math.round(sample * 32767);

      if (pcmInt16Data[i] < int16Min) int16Min = pcmInt16Data[i];
      if (pcmInt16Data[i] > int16Max) int16Max = pcmInt16Data[i];
    }
    // console.log("First 10 Int16 samples:", Array.from(pcmInt16Data.slice(0, 10)));
    // console.log("Int16 min:", int16Min);
    // console.log("Int16 max:", int16Max);
    // console.log("convertToPCM: Converted to Int16 PCM. Output ArrayBuffer size:", pcmInt16Data.buffer.byteLength);

    // console.log("Debug: pcmInt16Data.buffer byteLength:", pcmInt16Data.buffer.byteLength);
    // console.log("Debug: pcmInt16Data.buffer first 20 bytes:", Array.from(new Uint8Array(pcmInt16Data.buffer.slice(0, 20))));

    await audioContext.close(); // Close the temporary audio context
    return pcmInt16Data.buffer;
  }
  // @ts-ignore
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    // console.log("Debug: arrayBufferToBase64 - bytes length:", bytes.length);
    // console.log("Debug: arrayBufferToBase64 - first 20 bytes:", Array.from(bytes.slice(0, 20)));


    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private async startRecording() {
    try {
      // this.base64PCM = undefined;
      // this.base64Wav = undefined;
      this.monoFloat32Data = undefined; // Clear previous Float32 data

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.isRecording = true;
      this.audioChunks = [];

      // let mimeType = 'audio/webm';
      const options = { mimeType: '' };

      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        options.mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        options.mimeType = 'audio/ogg;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
        options.mimeType = 'audio/ogg';
      } else {
        console.warn("No preferred MIME type supported, using browser default.");
      }

      this.mediaRecorder = new MediaRecorder(stream, options.mimeType ? { mimeType: options.mimeType } : undefined);
      // console.log("Using MediaRecorder with MIME type:", this.mediaRecorder.mimeType);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };
      this.mediaRecorder.onstop = async () => {
        if (this.audioChunks.length === 0) {
          console.warn("No audio chunks recorded.");
          this.updateStatus("No audio data recorded. Please try again.");
          this.isRecording = false;
          this.updateUIAfterRecordingStop();
          stream.getTracks().forEach(track => track.stop());
          if (this.waveformAnimationId) cancelAnimationFrame(this.waveformAnimationId);
          if (this.timerIntervalId) clearInterval(this.timerIntervalId);
          this.audioContext?.close().catch(e => console.warn("Error closing AudioContext on no data:", e));
          this.audioContext = null;
          return;
        }
        const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });

        // console.log("Audio Blob created. Type:", audioBlob.type, "Size:", audioBlob.size);
        const dialogTabActive = document.querySelector('.tab-button[data-tab="dialog"]')?.classList.contains('active');

        console.log(`this.isDialogSessionConnected: ${this.isDialogSessionConnected}`)
        try {
          if (this.isDialogSessionConnected) {
            // convertToPCM will now store the Float32Array in this.monoFloat32Data
            await this.convertToPCM(audioBlob, 16000);

            if (this.monoFloat32Data && this.monoFloat32Data.length > 0) {
              // console.log("PCM (Float32) data ready for Dialog. Length:", this.monoFloat32Data.length);

              if (dialogTabActive && this.isDialogSessionConnected) {
                this.sendMessageToDialog(); // Will use the newly set this.monoFloat32Data

              } else {
                this.updateStatus("Recording complete. Audio data ready.");
              }

            } else {
              console.warn("PCM (Float32) data is empty after conversion.");
              this.updateStatus("Failed to process audio (empty PCM).");
              this.monoFloat32Data = undefined;

            }
          } else {
            this.processAudio(audioBlob);

          }




        } catch (error) {
          console.error("Error processing audio in onstop:", error);
          this.updateStatus(`Error processing audio: ${(error as Error).message}`);
          this.monoFloat32Data = undefined;
        } finally {
          stream.getTracks().forEach(track => track.stop());
          this.isRecording = false;
          this.updateUIAfterRecordingStop();

          if (this.waveformAnimationId) cancelAnimationFrame(this.waveformAnimationId);
          if (this.timerIntervalId) clearInterval(this.timerIntervalId);
          this.audioContext?.close().catch(e => console.warn("Error closing AudioContext:", e));
          this.audioContext = null;
        }
      };
      this.mediaRecorder.start();
      this.updateStatus("Recording...");
      this.recordButton.classList.add("recording");
      this.recordButtonInner.innerHTML = '<i class="fas fa-stop" aria-hidden="true"></i><span class="sr-only">Stop Recording</span>';


      this.recordingInterfaceElement.classList.add("is-live");
      this.liveRecordingTitleElement.style.display = "block";
      this.liveWaveformCanvas.style.display = "block";
      this.liveRecordingTimerDisplayElement.style.display = "block";
      (document.querySelector(".status-indicator")! as HTMLElement).style.display = "none";


      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 2048;
      this.waveformDataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
      source.connect(this.analyserNode);
      this.recordingStartTime = Date.now();
      this.drawLiveWaveform();
      this.startLiveTimer();

    } catch (error) {
      console.error("Error starting recording:", error);
      this.updateStatus(`Error: ${(error as Error).message}`);
      this.isRecording = false;
      this.monoFloat32Data = undefined;
    }
  }

  private stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      // onstop will handle the rest
    }
  }

  private updateUIAfterRecordingStop() {
    this.recordButton.classList.remove("recording");
    this.recordButtonInner.innerHTML = '<i class="fas fa-microphone" aria-hidden="true"></i><span class="sr-only">Start Recording</span>';
    this.updateStatus("Processing...");
    this.recordingInterfaceElement.classList.remove("is-live");

    this.liveRecordingTitleElement.style.display = "none";
    this.liveWaveformCanvas.style.display = "none";
    this.liveRecordingTimerDisplayElement.style.display = "none";
    (document.querySelector(".status-indicator")! as HTMLElement).style.display = "block";

  }

  private startLiveTimer() {
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    this.timerIntervalId = window.setInterval(() => {
      const elapsedTime = Date.now() - this.recordingStartTime;
      const totalSeconds = Math.floor(elapsedTime / 1000);
      const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
      const seconds = (totalSeconds % 60).toString().padStart(2, '0');
      const milliseconds = Math.floor((elapsedTime % 1000) / 10).toString().padStart(2, '0');
      this.liveRecordingTimerDisplayElement.textContent = `${minutes}:${seconds}.${milliseconds}`;
    }, 10);
  }


  private drawLiveWaveform() {
    if (!this.isRecording || !this.liveWaveformContext || !this.analyserNode || !this.waveformDataArray) {
      if (this.liveWaveformContext) {
        const { width, height } = this.liveWaveformCanvas;
        this.liveWaveformContext.fillStyle = getComputedStyle(document.body).getPropertyValue('--glass-recording-bg').trim() || 'rgba(30,30,30,0.75)';
        this.liveWaveformContext.fillRect(0, 0, width, height);
      }
      return;
    }

    this.waveformAnimationId = requestAnimationFrame(() => this.drawLiveWaveform());

    this.analyserNode.getByteTimeDomainData(this.waveformDataArray);

    const { width, height } = this.liveWaveformCanvas;
    this.liveWaveformContext.fillStyle = getComputedStyle(document.body).getPropertyValue('--glass-recording-bg').trim() || 'rgba(30,30,30,0.75)';
    this.liveWaveformContext.fillRect(0, 0, width, height);

    this.liveWaveformContext.lineWidth = 2;
    this.liveWaveformContext.strokeStyle = getComputedStyle(document.body).getPropertyValue('--color-accent').trim() || '#82aaff';
    this.liveWaveformContext.beginPath();

    const sliceWidth = (width * 1.0) / this.waveformDataArray.length;
    let x = 0;

    for (let i = 0; i < this.waveformDataArray.length; i++) {
      const v = this.waveformDataArray[i] / 128.0;
      const y = (v * height) / 2;

      if (i === 0) {
        this.liveWaveformContext.moveTo(x, y);
      } else {
        this.liveWaveformContext.lineTo(x, y);
      }
      x += sliceWidth;
    }
    this.liveWaveformContext.lineTo(width, height / 2);
    this.liveWaveformContext.stroke();
  }

  private responseToJson(rawtext: string) {
    const trim_format_idx = rawtext.indexOf("json");
    var text =
      rawtext.slice(0, trim_format_idx) + rawtext.slice(trim_format_idx + 4);

    text = text.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '');

    try {

      return JSON.parse(text);

    } catch (e) {

      console.log(`parse error: ${e} ,\nrawtext: ${rawtext}`)
      return null;
    }

  }

  private async processAudio(audioBlob: Blob) {
    this.updateStatus("Transcribing...");
    this.rawTranscriptionElement.innerHTML = "<p><i>Transcribing audio...</i></p>";
    this.polishedNoteElement.innerHTML = "<p><i>Waiting for transcription...</i></p>";

    try {
      if (audioBlob.size === 0) {
        throw new Error("Cannot process empty audio blob for transcription.");
      }
      const base64Audio = await this.blobToBase64(audioBlob);
      const audioPart = {
        inlineData: {
          mimeType: audioBlob.type,
          data: base64Audio,
        },
      };

      let RAW_TRANSCRIPT_MODEL = "gemini-2.5-flash-preview-04-17";
      let REFINE_TRANSCRIPT_MODEL = "gemini-2.5-flash-preview-04-17";

      // RAW_TRANSCRIPT_MODEL = "gemini-2.0-flash-lite";
      RAW_TRANSCRIPT_MODEL = "gemini-2.0-flash-lite";

      REFINE_TRANSCRIPT_MODEL = "gemma-3-27b-it";
      const prompt = `
  Transcribe the following audio and evaluate pronunciation. Return only JSON.
  
  Format:
  {
    "transcript": "...",
    "evaluate": "..."
  }
  `;
      // @ts-ignore
      const prompt2 = `
  Transcribe this audio recording. Evaluate pronounciation and grammar error in tense, stress, intonation and connected words.
  `;


      const rawTranscriptionResult: GenerateContentResponse = await this.genAI.models.generateContent({
        model: RAW_TRANSCRIPT_MODEL,
        contents: [{
          parts: [audioPart, {
            text: prompt
          }]
        }],
      });




      const rawTranscriptionText = rawTranscriptionResult.text;
      if (!rawTranscriptionText) return;


      const trim_format_idx = rawTranscriptionText.indexOf("json");
      const rawTranscriptionText_trim =
        rawTranscriptionText.slice(0, trim_format_idx) + rawTranscriptionText.slice(trim_format_idx + 4);
      console.log(`rawTranscriptionText: ${rawTranscriptionText} `)
      console.log(`rawTranscriptionText_trim: `)
      console.log(rawTranscriptionText_trim)
      // const transcript_jsonString = rawTranscriptionText.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '');

      var transcript_json = this.responseToJson(rawTranscriptionText);

      if (transcript_json) {
        this.addDialogMessageToUI(`#### Transcript\n ${transcript_json.transcript}`, 'model'); // Use original markdown for dialog
        this.addDialogMessageToUI(`#### Evaluate\n ${transcript_json.evaluate}`, 'model'); // Use original markdown for dialog

      } else {
        this.addDialogMessageToUI(`rawTranscriptionText:\n${rawTranscriptionText}`, 'model'); // Use original markdown for dialog

      }
      // try {

      //   transcript_json = JSON.parse(transcript_jsonString);
      //   console.log(`transcript_json: ${transcript_json} `)
      //   console.log(transcript_json)

      //   this.addDialogMessageToUI(`#### Transcript\n ${transcript_json.transcript}`, 'model'); // Use original markdown for dialog
      //   this.addDialogMessageToUI(`#### Evaluate\n ${transcript_json.evaluate}`, 'model'); // Use original markdown for dialog


      // } catch (e) {
      //   console.log(`parse error: ${e} `)
      //   this.addDialogMessageToUI(`rawTranscriptionText:\n${rawTranscriptionText}`, 'model'); // Use original markdown for dialog

      // }

      // this.addDialogMessageToUI(`transcript:\n${transcript_json.transcript || "" }`, 'model'); // Use original markdown for dialog
      // this.addDialogMessageToUI(`evaluate:\n${transcript_json.evaluate || "" }`, 'model'); // Use original markdown for dialog



      this.rawTranscriptionElement.textContent = rawTranscriptionText;
      this.updateStatus("Polishing notes...");
      this.polishedNoteElement.innerHTML = "<p><i>Polishing notes...</i></p>";

      const prompt3 = `
  ---
  
  ### **Explanation of the Approach:**
  
  1. **Native Rephrasing:**
     - Encourage fluency and naturalness.
     - Shorten or expand sentences where appropriate.
     - Replace formal or awkward phrasing with more conversational or colloquial alternatives.
  
  2. **Explanation of Changes:**
     - The LLM should briefly explain the rationale behind each rephrasing. For example:
       - Why "I just arrived" becomes "I just got here" (informal tone).
       - Why "there's a lot of light" is changed to "tons of natural light" (vividness, imagery).
  
  
  Return only JSON.
  
  Format:
  {
    "Rephrasing": "...",
    "Explanation": "..."
  }
  
  ---
  ${(transcript_json && transcript_json.transcript) || rawTranscriptionText}
  `;

      const polishedNoteResult: GenerateContentResponse = await this.genAI.models.generateContent({
        model: REFINE_TRANSCRIPT_MODEL,
        contents: [{ parts: [{ text: prompt3 }] }],
        config: {}
      });
      const polishedNoteText = polishedNoteResult.text;

      if (!polishedNoteText) return;

      var polished_json = this.responseToJson(polishedNoteText);

      if (polished_json) {
        this.addDialogMessageToUI(`#### Rephrasing\n ${polished_json.Rephrasing}`, 'model'); // Use original markdown for dialog
        this.addDialogMessageToUI(`#### Explanation\n ${polished_json.Explanation}`, 'model'); // Use original markdown for dialog

      } else {
        this.addDialogMessageToUI(`polishedNoteText:\n${polishedNoteText}`, 'model'); // Use original markdown for dialog

      }


      // const voice_scripts = marked.parse(polishedNoteText) as string;
      // this.polishedNoteElement.innerHTML = voice_scripts;
      // Also add the polished note to the dialog UI if the dialog tab is active and connected.
      // This is a design choice, you might want to only show it in the "Polished" tab.
      // For now, let's keep it consistent with your original request of adding it.
      // const dialogTabActive = document.querySelector('.tab-button[data-tab="dialog"]')?.classList.contains('active');
      // if (dialogTabActive && this.isDialogSessionConnected) {
      // }
      // this.addDialogMessageToUI(`${polishedNoteText}`, 'model'); // Use original markdown for dialog


      this.updateStatus("Done. Ready to record.");

    } catch (error) {
      console.error("Error processing audio for transcription/notes:", error);
      const errorMessage = `Error: ${(error as Error).message}`;
      this.rawTranscriptionElement.textContent = errorMessage;
      this.polishedNoteElement.innerHTML = `<p>Failed to generate polished note: ${errorMessage}</p>`;
      this.updateStatus(errorMessage);
    }
    this.setupContentEditablePlaceholder(this.rawTranscriptionElement);
    this.setupContentEditablePlaceholder(this.polishedNoteElement);
  }


  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!blob || blob.size === 0) {
        return reject(new Error("Cannot convert empty blob to Base64."));
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        if (result) {
          const base64String = result.split(",")[1];
          resolve(base64String);
        } else {
          reject(new Error("FileReader result was null or empty."));
        }
      };
      reader.onerror = (error) => {
        console.error("FileReader error:", error);
        reject(error);
      };
      reader.readAsDataURL(blob);
    });
  }

  private updateStatus(message: string) {
    this.recordingStatusElement.textContent = message;
  }
}

new DictationApp();