import React, { useState } from 'react'
import { View, Text } from 'react-native'
import { useEntitlements } from '../../entitlementsContext'
import PaywallModal from './PaywallModal'

export default function TelaPremium() {
  const { premium } = useEntitlements()
  const [open,setOpen]=useState(!premium)
  if (!premium)
    return <PaywallModal visible={open} onClose={()=>setOpen(false)} />
  return (
    <View><Text>Conteúdo Premium</Text></View>
  )
}