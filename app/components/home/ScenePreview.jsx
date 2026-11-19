'use client'

import React, { useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Coffee,
  Globe2,
  MessagesSquare,
} from 'lucide-react'

function RoomIllustration({ scene }) {
  return (
    <svg
      viewBox="0 0 500 160"
      className="home-room"
      fill="none"
      aria-hidden="true"
    >
      <path d="M0 160V0h500v160" className="home-room-wall" />
      <path
        d="M304 134V42a54 54 0 0 1 108 0v92z"
        className="home-room-window"
      />
      <path d="M358 0v134m-54-67h108M310 134h110" className="home-room-line" />
      <path d="m310 70 48-41 49 41M375 109l37-31" className="home-room-sun" />
      <path d="M0 137h500" className="home-room-line" />
      <path
        d="M70 137V90a25 25 0 0 1 50 0v47m-54-24h59m-53 24-5 23m51-23 5 23"
        className="home-room-furniture"
      />
      <path d="M168 99h142m-71 0v61m-25 0h50" className="home-room-furniture" />
      {scene === 0 ? (
        <>
          <path
            d="M209 81h23v17h-23zM233 84c13-3 13 12 0 9"
            className="home-room-pot"
          />
          <path
            d="M220 73c-7-9 7-10 0-19"
            className="home-steam home-room-line"
          />
          <path
            d="M272 97V70m0 8c-21 0-17-18-17-18 20 0 17 18 17 18Zm0 8c20 0 19-17 19-17-20 0-19 17-19 17Z"
            className="home-room-leaf"
          />
        </>
      ) : scene === 1 ? (
        <>
          <path
            d="M201 96h63l-9-35h-45l-9 35Zm-7 2h78"
            className="home-room-pot"
          />
          <path d="M278 98V79h15v19" className="home-room-furniture" />
        </>
      ) : (
        <>
          <path d="m202 97 7-44 64 8-8 36h-63Z" className="home-room-pot" />
          <path
            d="m217 64 45 5m-46 6 19 2m-20 6 19 2m8-8 17 2m-18 6 17 2"
            className="home-room-line"
          />
        </>
      )}
      <path
        d="M437 137v-31h26v31m-13-31V75m0 12c-24 0-26-22-26-22 24 0 26 22 26 22Zm0 9c26 0 29-26 29-26-26 0-29 26-29 26Z"
        className="home-room-leaf"
      />
      <path d="M120 0v30m-24 23 24-23 24 23H96Z" className="home-room-lamp" />
    </svg>
  )
}

export default function ScenePreview({ t }) {
  const [active, setActive] = useState(0)
  const tabs = useRef([])
  const scene = t.scenes[active]
  const Icon = [Coffee, MessagesSquare, Globe2][active]
  const onKeyDown = (event, index) => {
    let next
    if (event.key === 'ArrowRight') next = (index + 1) % t.scenes.length
    else if (event.key === 'ArrowLeft')
      next = (index + t.scenes.length - 1) % t.scenes.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = t.scenes.length - 1
    else return
    event.preventDefault()
    setActive(next)
    tabs.current[next]?.focus()
  }
  return (
    <div className="home-preview-wrap">
      <div className="home-preview-caption">
        <span>{t.label}</span>
        <span aria-hidden="true">↙</span>
      </div>
      <div className="home-preview">
        <div className="home-scene-tabs" role="tablist" aria-label={t.label}>
          {t.tabs.map((label, index) => (
            <button
              type="button"
              key={label}
              id={`scene-tab-${index}`}
              role="tab"
              aria-selected={active === index}
              aria-controls="scene-panel"
              tabIndex={active === index ? 0 : -1}
              ref={(el) => {
                tabs.current[index] = el
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              onClick={() => setActive(index)}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          id="scene-panel"
          role="tabpanel"
          aria-labelledby={`scene-tab-${active}`}
          tabIndex={0}
        >
          <div className="home-scene-banner">
            <RoomIllustration scene={active} />
            <div className="home-scene-place">
              <Icon size={15} aria-hidden="true" />
              {scene.location}
              <span>0{active + 1}</span>
            </div>
          </div>
          <div className="home-scene-body" key={active}>
            <h2>{scene.title}</h2>
            <div className="home-dialogue">
              <p className="home-speaker">{scene.role}</p>
              <p lang="en">{scene.prompt}</p>
              <p className="home-speaker home-you">{t.you}</p>
              <p lang="en" className="home-answer">
                {scene.answer}
              </p>
            </div>
            <div className="home-correction">
              <span>
                <ArrowUpRight size={16} aria-hidden="true" />
                {t.tip}
              </span>
              <p lang="en">{scene.correction}</p>
              <small>{scene.detail}</small>
            </div>
          </div>
        </div>
        <div className="home-preview-note">
          <span className="home-note-dot" />
          {t.note}
        </div>
      </div>
      <div className="home-collected" aria-hidden="true">
        <span>
          <Check size={13} />
          {t.scenes[active].word}
        </span>
        <small>{scene.translation}</small>
      </div>
      <p className="home-preview-handnote">{t.caption}</p>
    </div>
  )
}
