import { useState, useRef, useCallback, useEffect } from 'react';
import { fsAPI } from '../services/api';
import './PathInput.css';

interface PathSuggestion {
  name: string;
  path: string;
  type: 'file' | 'directory';
  displayPath: string;
}

interface PathInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (path: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export default function PathInput({ 
  value, 
  onChange, 
  onSelect, 
  placeholder = '输入路径...',
  autoFocus = false
}: PathInputProps) {
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 获取路径建议
  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query) {
      setSuggestions([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/fs/complete?query=${encodeURIComponent(query)}&limit=20`);
      if (response.ok) {
        const data = await response.json();
        setSuggestions(data.suggestions || []);
        setHighlightedIndex(-1);
      }
    } catch (err) {
      console.error('Failed to fetch suggestions:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 防抖处理输入
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      if (value && showSuggestions) {
        fetchSuggestions(value);
      }
    }, 150);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [value, showSuggestions, fetchSuggestions]);

  // 点击外部关闭建议列表
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setShowSuggestions(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Enter') {
        onSelect(value);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
          selectSuggestion(suggestions[highlightedIndex]);
        } else {
          onSelect(value);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
      case 'Tab':
        // Tab 自动补全到第一个建议
        if (suggestions.length > 0 && highlightedIndex >= 0) {
          e.preventDefault();
          selectSuggestion(suggestions[highlightedIndex]);
        }
        break;
    }
  };

  const selectSuggestion = (suggestion: PathSuggestion) => {
    const newPath = suggestion.type === 'directory' 
      ? suggestion.path + '/' 
      : suggestion.path;
    
    onChange(newPath);
    onSelect(newPath);
    
    // 如果是目录，继续显示建议
    if (suggestion.type === 'directory') {
      setShowSuggestions(true);
      fetchSuggestions(newPath);
    } else {
      setShowSuggestions(false);
    }
    
    inputRef.current?.focus();
  };

  const getFileIcon = (type: 'file' | 'directory', name: string) => {
    if (type === 'directory') return '📁';
    
    const ext = name.split('.').pop()?.toLowerCase();
    const iconMap: Record<string, string> = {
      'js': '📜', 'ts': '📘', 'jsx': '⚛️', 'tsx': '⚛️',
      'py': '🐍', 'java': '☕', 'go': '🐹', 'rs': '🦀',
      'html': '🌐', 'css': '🎨', 'json': '📋',
      'md': '📝', 'txt': '📄'
    };
    return iconMap[ext || ''] || '📄';
  };

  // 高亮匹配的部分
  const highlightMatch = (text: string, query: string) => {
    if (!query) return text;
    
    const lastSlashIndex = query.lastIndexOf('/');
    const searchPart = lastSlashIndex >= 0 
      ? query.substring(lastSlashIndex + 1).toLowerCase()
      : query.toLowerCase();
    
    if (!searchPart) return text;
    
    const index = text.toLowerCase().indexOf(searchPart);
    if (index < 0) return text;
    
    return (
      <>
        {text.substring(0, index)}
        <span className="highlight">{text.substring(index, index + searchPart.length)}</span>
        {text.substring(index + searchPart.length)}
      </>
    );
  };

  return (
    <div className="path-input-container" ref={containerRef}>
      <div className="path-input-wrapper">
        <span className="path-input-icon">📂</span>
        <input
          ref={inputRef}
          type="text"
          className="path-input"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
        />
        {isLoading && <span className="path-input-loading">⟳</span>}
      </div>
      
      {showSuggestions && suggestions.length > 0 && (
        <div className="path-suggestions">
          {suggestions.map((suggestion, index) => (
            <div
              key={suggestion.path}
              className={`path-suggestion ${index === highlightedIndex ? 'highlighted' : ''}`}
              onClick={() => selectSuggestion(suggestion)}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <span className="suggestion-icon">
                {getFileIcon(suggestion.type, suggestion.name)}
              </span>
              <span className="suggestion-name">
                {highlightMatch(suggestion.name, value)}
              </span>
              <span className="suggestion-type">
                {suggestion.type === 'directory' ? '目录' : '文件'}
              </span>
            </div>
          ))}
        </div>
      )}
      
      {showSuggestions && value && suggestions.length === 0 && !isLoading && (
        <div className="path-suggestions empty">
          <span className="no-results">无匹配结果</span>
        </div>
      )}
    </div>
  );
}
