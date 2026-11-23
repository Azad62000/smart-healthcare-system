"""QDiabetes-2018 Model C port. See LICENSE, COPYRIGHTS and QDR2018C.R."""
import math
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field, model_validator

app = FastAPI(title="QDiabetes-2018 Model C", version="1.0.0")

class Input(BaseModel):
    sex: Literal["Female", "Male"]
    age: float = Field(ge=25, lt=85)
    bmi: float = Field(ge=40 / 2.1**2, le=180 / 1.4**2)
    hba1c: float = Field(ge=15, lt=48, description="mmol/mol")
    ethnicity: Literal["WhiteNA", "Indian", "Pakistani", "Bangladeshi", "OtherAsian", "BlackCaribbean", "BlackAfrican", "Chinese", "Other"] = "WhiteNA"
    smoking: Literal["Non", "Ex", "Light", "Moderate", "Heavy"] = "Non"
    townsend: float = Field(default=0, ge=-8, le=14)
    family_history: bool = False
    treated_hypertension: bool = False
    cardiovascular_disease: bool = False
    gestational_diabetes: bool = False
    pcos: bool = False
    learning_disability: bool = False
    psychiatric_disorder: bool = False
    corticosteroids: bool = False
    statins: bool = False
    atypical_antipsychotics: bool = False

    @model_validator(mode="after")
    def female_only(self):
        if self.sex == "Male" and (self.gestational_diabetes or self.pcos):
            raise ValueError("gestational_diabetes and pcos must be false for male sex")
        return self

def risk(x: Input) -> float:
    female = x.sex == "Female"
    # Centering, transformations, and all coefficients below follow QDR2018C.R.
    a = x.age / 10
    a1 = (math.sqrt(a) - 2.123332023620606) if female else (math.log(a) - 1.496392488479614)
    a2 = a**3 - (91.644744873046875 if female else 89.048171997070313)
    age = (3.5655214891947722*a1 - 0.0056158243572733135*a2) if female else (4.0193435623978031*a1 - 0.0048396442306278238*a2)
    bmi = min(40, max(20, x.bmi)); b = bmi/10
    b1 = b - 2.571253299713135 if female else b*b - 6.817805767059326
    b2 = b**3 - (16.999439239501953 if female else 17.801923751831055)
    bm = 2.5043028874544841*b1 - 0.042875801892690461*b2 if female else 0.81829168905349325*b1 - 0.12558808701359642*b2
    tds = (0.035866822056348294*(x.townsend-0.391116052865982) if female else 0.025229965184900727*(x.townsend-0.515986680984497))
    h = x.hba1c/10; h1=math.sqrt(h); h2=h
    if female:
        h1-=1.886751174926758; h2-=3.559829950332642
        hb=8.7368031307362184*h1-0.07823138666994997*h2
    else:
        h1-=1.900265336036682; h2-=3.611008167266846
        hb=8.0511642238857934*h1-0.14652346893914495*h2
    eth_f={"Indian":.599095159929154,"Pakistani":.78320309656353893,"Bangladeshi":1.1947351247960103,"OtherAsian":.71417446991681433,"BlackCaribbean":.11953284683887688,"BlackAfrican":.013668872878490427,"Chinese":.57092265376939455,"Other":.17091076281069292}
    eth_m={"Indian":.67571207054987803,"Pakistani":.83147325049663456,"Bangladeshi":1.0969133802228563,"OtherAsian":.76822446364560482,"BlackCaribbean":.20897529259108502,"BlackAfrican":.38091593781970579,"Chinese":.34235836796612695,"Other":.22046477853433083}
    sm_f={"Ex":.065848258510000673,"Light":.1458413689734224,"Moderate":.15258642474801187,"Heavy":.30787416796613976}
    sm_m={"Ex":.11592891206878651,"Light":.14624182637633271,"Moderate":.10781424112493142,"Heavy":.19848629163668474}
    eth=(eth_f if female else eth_m).get(x.ethnicity,0); smok=(sm_f if female else sm_m).get(x.smoking,0)
    flags={"apsy":x.atypical_antipsychotics,"ster":x.corticosteroids,"cvd":x.cardiovascular_disease,"gdm":x.gestational_diabetes,"learn":x.learning_disability,"psy":x.psychiatric_disorder,"pcos":x.pcos,"stat":x.statins,"htn":x.treated_hypertension,"fhdm":x.family_history}
    if female:
        coeff={"apsy":.54976333110422004,"ster":.16872205506389704,"cvd":.16443300362739344,"gdm":1.125009810517114,"learn":.28912058310739658,"psy":.31825122490684077,"pcos":.33806444140981745,"stat":.45593968473811164,"htn":.4040022295023758,"fhdm":.44280154048260317}
        inter=(-.81254341971621313*a1*flags['apsy']+.0004665611306005428*a2*flags['apsy']-.90846657652698082*a1*flags['learn']+.00085189801399280065*a2*flags['learn']-1.8557960585560658*a1*flags['stat']+.0022627250963352537*a2*flags['stat']+.6023218765235252*a1*b1-.0043386645663133425*a2*b1-.03449503839680447*a1*b2+.00011627785616712089*a2*b2+25.441203322736715*a1*h1-.052254135588592522*a2*h1-6.8076080421556107*a1*h2+.014054825906114453*a2*h2-.27275713515061872*a1*flags['fhdm']+.00043545197952207749*a2*flags['fhdm'])
    else:
        coeff={"apsy":.45541525220173301,"ster":.13816187686823922,"cvd":.14546988896239518,"learn":.2596046658040857,"psy":.28523788490585894,"stat":.42551951901185525,"htn":.33169430006459311,"fhdm":.56612325943680619}
        inter=(-1.0013331909079835*a1*flags['apsy']+.00022455973985742407*a2*flags['apsy']-.89164657372215927*a1*flags['learn']+.00066044360765696482*a2*flags['learn']-1.7074561167819817*a1*flags['stat']+.0013873509357389619*a2*flags['stat']+.45074527472672443*a1*b1-.0012224736160287865*a2*b1-.10851859809165601*a1*b2+.0002266731010346126*a2*b2+27.670593827146565*a1*h1-.05920145812475433*a2*h1-7.4006134846785434*a1*h2+.015592089485149988*a2*h2-.61410093887097161*a1*flags['fhdm']+.00050602582894772091*a2*flags['fhdm'])
    score=eth+smok+bm+age+tds+hb+sum(coeff.get(k,0)*v for k,v in flags.items())+inter
    base=.988788545131683 if female else .981181740760803
    return 100*(1-base**math.exp(score))

@app.get("/health")
def health(): return {"status":"ok","model":"QDiabetes-2018 Model C"}

@app.post("/risk")
def calculate(x: Input):
    return {"risk_percent":risk(x),"horizon_years":10,"model":"QDiabetes-2018 Model C","purpose":"risk estimate, not a diagnosis","population_notice":"Designed for UK populations; not validated for Indian patients."}
