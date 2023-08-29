pico-8 cartridge // http://www.pico-8.com
version 41
__lua__
-- qpa utility
-- by luchak

-- cart state globals
--dropped=nil
--samples=nil
--pos=nil

function _update()
 if stat(120) then
  dropped=true
  pos=nil
  local n=
   qpa_dnd_to_memory(0x8000)
  if n then
   samples=
    qpa_decode_memory(0x8000,n)
   if samples then
    printh(
     escape_binary_str(
      chr(peek(0x8000,n))
     ),
     '@clip'
    )
   end
  end
 end

 if samples then
  if (btnp(5)) pos=0
  if pos and pos<#samples then
   if stat(108)<768 then
    local n=mid(
     #samples-pos,256
    )
    for i=0,n-1 do
     poke(0x4300+i,samples[pos+i])
    end
    serial(0x808,0x4300,n)
    pos+=n
   end
  end
 end
end

function _draw()
 cls()

 if samples then
  print(#samples..' samples loaded')
  print('string copied to clipboard')
  print('press ❎ to play')
 else
  if dropped then
   print('cannot decode file')
  end
  print('drop a .qpa or .defy file')
  print('(.defy files must use qpa')
  print('compression)')
 end
end


-->8
-- qpa reading and decoding
--
-- usage to load a dropped
-- sample and decode it to
-- memory:
--
-- if stat(120) then
--  local n=
--   qpa_dnd_to_memory(0x8000)
--  if n then
--   sample=qpa_decode_memory(
--    0x8000,
--    n_bytes
--   )
--  end
-- end


qpa_cfg={
 [0x3161.7071]='28,4,1,0x.2|-0x.2',
 [0x3261.7071]='14,4,2,0x.1|-0x.1|.25|-.25',
 [0x3361.7071]='10,2,3,0x.6|-0x.6|0x1.4b|-0x1.4b|0x2.8f|-0x2.8f|4|-4',
 [0x3461.7071]='9,5,3,0x.02|-0x.02|0x.08|-0x.08|0x.0f|-0x.0f|0x.18|-0x.18',
 [0x3561.7071]='7,4,4,0x.06|-0x.06|0x.14|-0x.14|0x.24|-0x.24|0x.35|-0x.35|0x.47|-0x.47|0x.5a|-0x.5a|0x.6d|-0x.6d|.5|-.5',
}

--- copy qpa data from a dropped
--  file into pico-8 memory,
--  limiting its length to about
--  0x7fff samples, and removing
--  a defy header if present
-- @param base the address to
--  start writing to in pico-8
--  memory
-- @param max_size the maximum
--  number of bytes to write
function qpa_dnd_to_memory(
 base,
 n_max
)
 n_max=n_max or 0x5000
 local n_in=serial(0x800,base,12)
 if
  chr(peek(base,12))==
  'defydefy    '
 then
  -- strip defy header
  for i=1,2061 do
   serial(0x800,base,4)
  end
  n_in=serial(0x800,base,n_max)
 else
  n_in+=serial(
   0x800,base+12,n_max-12
  )
 end
 local cfg=qpa_cfg[$base]
 local n_out
 if cfg then
  local slice_len=unpack(split(
   cfg
  ))
  local n_samples=$(base+4)
  cls()
  if n_samples&0xff00==0 then
   n_samples=mid(
    n_samples,0x.7fe3
   )
   n_samples=min(
    n_samples,
    (((n_in-8)\4>>16)*slice_len)
   )
   local n_slices=(
    (n_samples<<16)+slice_len-1
   )\slice_len

   poke4(base+4,n_samples)
   n_out=8+4*n_slices
  end
 end
 -- skip any remaining bytes
 -- in dropped file
 local tmp={peek4(base,64)}
 while stat(120) do
  serial(0x800,base,256)
 end
 poke4(base,unpack(tmp))
 return n_out
end

--- decode qpa data stored in
--  pico-8 memory
-- @param base the start address
--  of the data in memory
-- @param size the length of the
--  data in memory, in bytes
-- @returns an array of decoded
--  u8 samples, or nil on error
function qpa_decode_memory(
 base,
 size
)
 local ptr=base

 local n_slice,b_scale,b_resid,
  dq_tab=unpack(split(
   qpa_cfg[$ptr] or ''
  ))
 if (not dq_tab) return
 ptr+=4

 dq_tab=split(dq_tab,'|')

 local n_left=
  min($ptr,0x.7fe3)<<16
 ptr+=4
 local hist=split"0,0,0,0"
 local weights=split"0,0,-32,64"

 local data={}
 while
  n_left>0 and ptr-base<size
 do
  local shift=16-b_scale
  local sf=((
   $ptr>>shift&(1<<b_scale)-1
  )+1)^2
  for i=1,min(n_slice,n_left) do
   shift-=b_resid
   local pred=dq_tab[
    1+(
     $ptr>>shift&(1<<b_resid)-1
    )
   ]*sf
   local d=pred>>4
   for j=1,4 do
    pred+=weights[j]*hist[j]
    weights[j]+=d*sgn(hist[j])
   end
   pred=mid(-128,pred,127)
   deli(hist,1)
   add(hist,pred>>8)
   add(data,pred+128)
   n_left-=1
  end
  ptr+=4
 end
 return data
end

--- decode qpa data stored in a
--  binary string.
-- @param s a string containing
--  qpa-encoded data
-- @returns an array of decoded
--  u8 samples, or nil on error
function qpa_decode_string(s)
 local ptr=1
 local function get_word()
  local a,b,c,d=ord(s,ptr,4)
  ptr+=4
  return d<<8|c|b>>8|a>>16
 end

 local n_slice,b_scale,b_resid,
  dq_tab=
  unpack(split(
   qpa_cfg[get_word()] or ''
  ))
 if (not dq_tab) return

 dq_tab=split(dq_tab,'|')

 local n_left=min(
  get_word(),
  0x.7fe3
 )<<16
 local h=split"0,0,0,0"
 local w=split"0,0,-32,64"

 local data={}
 while n_left>0 do
  local w=get_word()
  local shift=16-b_scale
  local sf=(
   1+(w>>shift&(1<<b_scale)-1)
  )^2
  for i=1,min(n_slice,n_left) do
   shift-=b_resid
   local pred=dq_tab[
    1+(w>>shift&(1<<b_resid)-1)
   ]*sf
   local d=pred>>4
   for j=1,4 do
    pred+=weights[j]*hist[j]
    weights[j]+=d*sgn(hist[j])
   end
   pred=mid(-128,pred,127)
   deli(hist,1)
   add(hist,pred>>8)
   add(data,pred+128)
   n_left-=1
  end
 end
 return data
end

-->8
-- other utils

function escape_binary_str(s)
 local out=""
 for i=1,#s do
  local c=sub(s,i,i)
  local nc=ord(s,i+1)
  local pr=(nc and nc>=48 and nc<=57) and "00" or ""
  local v=c
  if(c=="\"") v="\\\""
  if(c=="\\") v="\\\\"
  if(ord(c)==0) v="\\"..pr.."0"
  if(ord(c)==10) v="\\n"
  if(ord(c)==13) v="\\r"
  out..= v
 end
 return out
end


__gfx__
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00700700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00077000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00077000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00700700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
