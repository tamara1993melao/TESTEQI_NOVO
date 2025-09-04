import React, { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

const PlanoCtx = createContext({ plano:'free', setPlano:()=>{} })

export function PlanoProvider({ children }) {
  const [plano, setPlano] = useState('free')

  // Futuro: buscar assinatura do usuário no Supabase
  useEffect(() => {
    // placeholder
  }, [])

  return (
    <PlanoCtx.Provider value={{ plano, setPlano }}>
      {children}
    </PlanoCtx.Provider>
  )
}

export function usePlano() {
  return useContext(PlanoCtx)
}
