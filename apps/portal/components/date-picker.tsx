'use client';

import { useEffect, useRef, useState } from 'react';

type DatePickerProps = {
  disabled?: boolean;
  id?: string;
  name: string;
  onChange?: (_value: string) => void;
  placeholder?: string;
  value?: string;
};

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  if (!year || !month || !day) return dateStr;
  return `${month}/${day}/${year}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

export function DatePicker({
  disabled = false,
  id,
  name,
  onChange,
  placeholder = 'mm/dd/yyyy',
  value = '',
}: DatePickerProps) {
  const [selectedDate, setSelectedDate] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelectedDate(value);
  }, [value]);

  function updateSelectedDate(nextValue: string) {
    setSelectedDate(nextValue);
    onChange?.(nextValue);
  }

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const parsedDate = selectedDate ? new Date(selectedDate) : new Date();
  const [viewYear, setViewYear] = useState(
    isNaN(parsedDate.getTime()) ? new Date().getFullYear() : parsedDate.getFullYear(),
  );
  const [viewMonth, setViewMonth] = useState(
    isNaN(parsedDate.getTime()) ? new Date().getMonth() : parsedDate.getMonth(),
  );

  function handlePrevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((prev) => prev - 1);
    } else {
      setViewMonth((prev) => prev - 1);
    }
  }

  function handleNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((prev) => prev + 1);
    } else {
      setViewMonth((prev) => prev + 1);
    }
  }

  function handleSelectDay(day: number) {
    const m = String(viewMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    const dateVal = `${viewYear}-${m}-${d}`;
    updateSelectedDate(dateVal);
    setIsOpen(false);
  }

  function handleClear() {
    updateSelectedDate('');
    setIsOpen(false);
  }

  function handleSelectToday() {
    const today = new Date();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const dateVal = `${today.getFullYear()}-${m}-${d}`;
    updateSelectedDate(dateVal);
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setIsOpen(false);
  }

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDayOfWeek = getFirstDayOfWeek(viewYear, viewMonth);

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  const displayVal = formatDisplayDate(selectedDate);

  return (
    <div className="date-picker-wrapper" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        className={`date-picker-trigger${isOpen ? ' is-open' : ''}`}
        disabled={disabled}
        id={id}
        onClick={() => setIsOpen((prev) => !prev)}
        type="button"
      >
        <span className={displayVal ? 'date-picker-value' : 'date-picker-placeholder'}>
          {displayVal || placeholder}
        </span>
        <svg
          className="date-picker-icon"
          fill="none"
          height="16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
          width="16"
        >
          <rect height="18" rx="2" width="18" x="3" y="4" />
          <path d="M16 2v4" />
          <path d="M8 2v4" />
          <path d="M3 10h18" />
        </svg>
      </button>

      <input name={name} type="hidden" value={selectedDate} />

      {isOpen && !disabled ? (
        <div className="date-picker-popover" role="dialog">
          <div className="date-picker-header">
            <span className="date-picker-month-title">
              {monthNames[viewMonth]} {viewYear}
            </span>
            <div className="date-picker-nav">
              <button
                aria-label="Previous month"
                className="date-picker-nav-btn"
                onClick={handlePrevMonth}
                type="button"
              >
                ‹
              </button>
              <button
                aria-label="Next month"
                className="date-picker-nav-btn"
                onClick={handleNextMonth}
                type="button"
              >
                ›
              </button>
            </div>
          </div>

          <div className="date-picker-weekdays">
            {WEEKDAYS.map((w) => (
              <span className="date-picker-weekday" key={w}>
                {w}
              </span>
            ))}
          </div>

          <div className="date-picker-days-grid">
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div className="date-picker-day-empty" key={`empty-${i}`} />
            ))}

            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dayNum = i + 1;
              const m = String(viewMonth + 1).padStart(2, '0');
              const d = String(dayNum).padStart(2, '0');
              const thisDateStr = `${viewYear}-${m}-${d}`;
              const isSelected = selectedDate === thisDateStr;
              const isToday =
                new Date().getFullYear() === viewYear &&
                new Date().getMonth() === viewMonth &&
                new Date().getDate() === dayNum;

              return (
                <button
                  className={`date-picker-day-btn${isSelected ? ' is-selected' : ''}${
                    isToday ? ' is-today' : ''
                  }`}
                  key={dayNum}
                  onClick={() => handleSelectDay(dayNum)}
                  type="button"
                >
                  {dayNum}
                </button>
              );
            })}
          </div>

          <div className="date-picker-footer">
            <button
              className="date-picker-footer-btn"
              onClick={handleClear}
              type="button"
            >
              Clear
            </button>
            <button
              className="date-picker-footer-btn date-picker-footer-btn-primary"
              onClick={handleSelectToday}
              type="button"
            >
              Today
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
