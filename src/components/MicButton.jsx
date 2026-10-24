import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import WorkbenchDialog from './ui/WorkbenchDialog';
import { Mic, MicOff } from 'lucide-react';

const SpeechRecognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export function MicButton({ onTranscript, className = '', showLabel = false }) {
  const { t, i18n } = useTranslation('chat');
  const [state, setState] = useState('idle'); // idle | recording
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);
  const committedIndexRef = useRef(0); // index of next result to commit
  const buttonRef = useRef(null);

  const isSupported = !!SpeechRecognition;

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setState('idle');
  }, []);

  const startRecording = useCallback(() => {
    setError(null);
    committedIndexRef.current = 0;

    const recognition = new SpeechRecognition();
    recognition.lang = i18n.language.startsWith('zh') ? 'zh-CN' : i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      // Collect only NEW final results (index >= committedIndex)
      let newFinal = '';

      for (let i = committedIndexRef.current; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          newFinal += result[0].transcript;
          committedIndexRef.current = i + 1;
        }
      }

      // Only call onTranscript with genuinely new finalized text
      if (newFinal && onTranscript) {
        onTranscript(newFinal);
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      const err = event.error;
      if (err === 'not-allowed') {
        setError('voice.denied');
      } else if (err === 'network' || err === 'ne') {
        setError('voice.network');
      } else if (err === 'audio-capture') {
        setError('voice.noDevice');
      } else if (err !== 'no-speech' && err !== 'aborted') {
        setError('voice.failed');
      }
      stopRecording();
    };

    recognition.onend = () => {
      setState('idle');
      recognitionRef.current = null;
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setState('recording');
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setError('voice.failed');
    }
  }, [onTranscript, stopRecording, i18n.language]);

  const handleClick = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (!isSupported) {
      setError('voice.unsupported');
      return;
    }

    if (state === 'idle') {
      startRecording();
    } else {
      stopRecording();
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const isRecording = state === 'recording';

  return (
    <div className="relative">
      <button ref={buttonRef} type="button" aria-pressed={isRecording}
        aria-label={t(isRecording ? 'voice.stop' : 'voice.start')}
        title={t(isRecording ? 'voice.stop' : 'voice.start')}
        onClick={handleClick}
        className={`flex items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${isRecording ? 'bg-destructive text-destructive-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'} ${className || 'h-11 w-11'}`}>
        {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        {showLabel && <span>{t(isRecording ? 'voice.stop' : 'voice.start')}</span>}
      </button>
      {error && <WorkbenchDialog title={t('voice.title')} onClose={() => setError(null)}>
        <p role="alert" className="text-sm">{t(error)}</p>
      </WorkbenchDialog>}
    </div>
  );
}
