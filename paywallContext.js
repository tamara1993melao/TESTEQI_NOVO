import React, { createContext, useContext, useState, useCallback } from 'react'
export const PaywallCtx = createContext({ visible:false, foco:null, open:()=>{}, close:()=>{} })
export function PaywallProvider({ children }) {
  const [visible,setVisible] = useState(false)
  const [foco,setFoco] = useState(null)
  const open = useCallback((f=null)=>{ setFoco(f); setVisible(true) },[])
  const close = useCallback(()=>{ setVisible(false); setFoco(null) },[])
  return (
    <PaywallCtx.Provider value={{ visible, foco, open, close }}>
      {children}
    </PaywallCtx.Provider>
  )
}
export const usePaywall = ()=> useContext(PaywallCtx)